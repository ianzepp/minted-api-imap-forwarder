# mintedgeek-api-imap-forwarder

Listens to new messages in IMAP mailboxes and forwards them to the Minted API for processing

# Configuration

Create a `.env` file with the following key-value pairs:

```
## IMAP Config
IMAP_HOST="<host>"
IMAP_PORT="<port>"
IMAP_USER="<username>"
IMAP_PASS="<password>"

## IMAP interval (in seconds) between mailbox checks
IMAP_INTERVAL=60

## Minted API config
API_ENDPOINT="<endpoint>"
```

Alternately, set those values in the running process environment.

# Installation

Execute `npm install`.

# Running

Execute `npm start`.

