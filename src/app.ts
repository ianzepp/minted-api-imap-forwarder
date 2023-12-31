import _ from 'lodash';
import Debug from 'debug';
import Imap from 'node-imap';
import chai from 'chai';
import axios from 'axios';

// Sanity
chai.expect(Bun.env.IMAP_USER, 'IMAP_USER').string;
chai.expect(Bun.env.IMAP_USER, 'IMAP_HOST').string;
chai.expect(Bun.env.IMAP_USER, 'IMAP_PORT').string;

// Interfaces
interface MailData {
    attr: _.Dictionary<any>,
    head: _.Dictionary<string | string[]>,
    data: string,
}

// Debugging
const debug = Debug('imap');

// Listen interval
const IMAP_INTERVAL = _.toInteger(Bun.env.IMAP_INTERVAL || '60');

// Config setup
export class ImapForwarder {
    // Imap connection
    private imap: Imap; 
    private reconnectDelay: number = 5000;  // in milliseconds

    // Inside your forwardLoop() function:
    async forwardLoop() {
        while (true) {
            try {
                await this.forward();
                await new Promise(resolve => setTimeout(resolve, IMAP_INTERVAL * 1000));
            } catch (error) {
                debug('Error in forwardLoop, attempting to reconnect:', error);
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
            }
        }
    }

    async forward() {
        this.imap = new Imap({
            user: Bun.env.IMAP_USER,
            password: Bun.env.IMAP_PASS,
            host: Bun.env.IMAP_HOST,
            port: _.toInteger(Bun.env.IMAP_PORT),
            autotls: true
        });

        try {
            // Connect to the IMAP server
            await this.connect();

            // Open the inbox
            await this.openBox('INBOX');

            // For each message, forward to a remote API server for processing, and
            // then mark the message as `SEEN`.
            for (let message of await this.fetch()) {
                await this.send(message);
                await this.seen(message);
            }
        } 
        
        catch (error) {
            debug('forward(): caught error:', error.stack || error);
        }

        finally {
            await this.imap.end();
        }
    }

    private connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            debug(`connect(): imap host="${ Bun.env.IMAP_HOST }:${ Bun.env.IMAP_PORT}" user="${ Bun.env.IMAP_USER }"`);

            // Promise resolve/reject
            this.imap.once('ready', () => {
                debug('connect(): imap ready');
                resolve();
            });

            // Errors
            this.imap.once('error', (error) => {
                debug('connect(): imap error:', error);
                reject(error);
            });

            
            // When connection ended
            this.imap.once('end', () => {
                debug('connect(): imap connection ended');
            });

            // Start the connection
            this.imap.connect();
        });
    }

    private openBox(mailbox: string): Promise<any> {
        return new Promise((resolve, reject) => {
            debug('openBox():', mailbox);

            // Open the mailbox in read/write mode, so we can later mark messages as `SEEN`
            this.imap.openBox(mailbox, false, (err, box) => {
                if (err) reject(err);
                else resolve(box);
            });
        });
    }

    private fetch(): Promise<any> {
        return new Promise((resolve, reject) => {
            debug('fetch(): looking for unseen messages');

            // Track messages for final processing
            let messages: MailData[] = [];

            // Load messages from the imap server  
            this.imap.search(['UNSEEN'], (error, results = []) => {
                debug('fetch(): found', results.length);

                if (error) {
                    return reject(error);
                }

                if ((results ?? null) === null || results.length === 0) {
                    return resolve([]);
                }

                if (results.length === 0) {
                    return resolve([]);
                }

                // Get the messages
                let fetch = this.imap.seq.fetch(results, { bodies: [''], struct: true });

                // Message handling
                fetch.on('message', (msg, seqno) => this.read(msg, seqno, messages));

                // Promise results
                fetch.once('error', reject);
                fetch.once('end', () => resolve(messages));
            });
        });
    }

    private read(msg: any, seqno: number, messages: MailData[]) {
        var mail: MailData = {
            attr: {},
            head: {},
            data: '',
        };

        // Add to the messages list
        messages.push(mail);

        // Handle mail body stream
        msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
                mail.data += chunk.toString('utf8');
            });
        });

        // Handle mail attributes
        msg.once('attributes', (attr) => {
            mail.attr = attr;
        });

        // Handle end of mail data
        msg.once('end', () => {
            // Read all headers
            mail.head = Imap.parseHeader(mail.data);
            
            // Process header arrays into single values (where needed)
            mail.head = _.transform(mail.head, (result, data, name) => {
                if (_.isArray(data) && data.length > 2) 
                    return _.set(result, name, data);
                if (_.isArray(data))
                    return _.set(result, name, _.head(data) ?? null);
                return _.set(result, name, data);
            }, {});

            // Sort header names for readability
            mail.head = _.pick(mail.head, _.keys(mail.head).sort());

            // Done
            debug('read():', mail.head.from, mail.head.subject);
        });
    }

    private async send(mail: MailData): Promise<any> {
        let endpoint = `${ Bun.env.API_ENDPOINT }/api/data/mail`;
        let body = {
            type: 'mail',
            data: {
                name: mail.head.subject,
                from: mail.head.from,
                body: mail.data,
                head: mail.head,
            }
        };

        debug('send()', body.data.from, body.data.name);

        let result = await axios.post(endpoint, body, {
            // headers: {
            //     'Authorization': `Bearer ${Bun.env.API_BEARER_TOKEN}`,
            //     'Content-Type': 'application/json',
            // }
        });

        debug('send(): axios result:', result.status, _.pick(result.data.data, ['id']));
    }

    private async seen(mail: MailData): Promise<any> {
        return new Promise((resolve, reject) => {
            debug('seen()', mail.attr.uid);

            this.imap.addFlags(mail.attr.uid, ['\\Seen'], (error) => {
                if (error) reject(error);
                else resolve(undefined);
            });
        });
    }

}