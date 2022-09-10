const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const ADDRESS_BOOK = [];
const GOOD_DOMAINS = (process.env.GS_GOOD_DOMAINS || '').split(',');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content.toString()), listLabels);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
        client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token.toString()));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {import('googleapis').Auth.OAuth2Client} oAuth2Client The OAuth2 client to get token for.
 * @param {function} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Lists the labels in the user's account.
 *
 * @param {import('googleapis').Auth.OAuth2Client} auth An authorized OAuth2 client.
 */
function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });

    getAllMessages(gmail)
        .then(messages => {
            console.log(messages.length);
            const senders = {};

            messages.forEach(element => {
            const header = element.payload.headers.filter(header => header['name'] == 'From')[0];
            const sender = parseSender(header.value)
            
            if (senders[sender.email] === undefined) {
                senders[sender.email] = 0;
            }
            senders[sender.email]++;
            });

            const keys = Object.keys(senders).sort((a,b) => senders[b] - senders[a]);

            keys.forEach(key => {
                if (senders[key] >= 5 && !isGoodEmail(key)) {
                    console.log(key, senders[key]);
                }
            });
        })
        .catch(err => {
            console.error(err);
        });
}

function parseSender(text) {
    const res = text.split('<');
    if (res[1]) {
        return {name: res[0].slice(0, -1), email: res[1].slice(0, -1).toLowerCase()};
    } else {
        return {name: 'Unknown', email: res[0].toLowerCase()};
    }
}

/**
 * @param {string} email
 */
function isGoodEmail(email) {
    if (ADDRESS_BOOK.includes(email)) {
        return true;
    }

    const res = email.split('@');
    if (GOOD_DOMAINS.includes(res[1])) {
        return true;
    } else {
        return false;
    }
}
/**
 * 
 * @param {import('googleapis').gmail_v1.Gmail} gmail - test
 */
async function getAllMessages(gmail) {
    const messages = getCachedMessages();
    if (messages.length) return messages;

    const indices = getCachedIndices();
    if (!indices.length) {
        console.log('Loading indices...');

        let hasMoreData = true;
        let nextPageToken = undefined;

        while (hasMoreData) {
            const data = await listMessages(gmail, nextPageToken);
            indices.push(...data.messages);
            nextPageToken = data.nextPageToken
            hasMoreData = !!nextPageToken;
        }

        fs.writeFileSync('messages_index.json', JSON.stringify(indices));
    }

    console.log('Loading metadata...');
    for (let i = 0; i < indices.length; i++) {
        console.log(`${i}/${indices.length}`);
        const data = await getMessageById(gmail, indices[i].id);
        messages.push(data);
    }

    fs.writeFileSync('messages_content.json', JSON.stringify(messages));

    return messages;
}

function getCachedIndices() {
    try {
        const content = fs.readFileSync('messages_index.json');
        return JSON.parse(content.toString());
    } catch (error) {
        console.error(error);
        return [];   
    }
}

function getCachedMessages() {
    try {
        const content = fs.readFileSync('messages_content.json');
        return JSON.parse(content.toString());
    } catch (error) {
        console.error(error);
        return [];   
    }
}

/**
 * 
 * @param {import('googleapis').gmail_v1.Gmail} gmail 
 * @param {*} pageToken 
 */
async function listMessages(gmail, pageToken) {
    return new Promise((resolve, reject) => {
        gmail.users.messages.list({
            userId: 'me',
            maxResults: 500,
            pageToken: pageToken,
        }, (err, res) => {
            if (err) reject(err);
            else resolve(res.data);
        });
    });
}

/**
 * 
 * @param {import('googleapis').gmail_v1.Gmail} gmail 
 * @param {*} id 
 * @returns 
 */
async function getMessageById(gmail, id) {
    return new Promise((resolve, reject) => {
        gmail.users.messages.get({
            userId: 'me',
            id: id,
            format: 'METADATA',
            metadataHeaders: ['From', 'To', 'Subject']
        }, (err, res) => {
            if (err) reject(err);
            else resolve(res.data);
        });
    });
}