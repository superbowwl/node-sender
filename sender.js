const fs = require('fs');
const readline = require('readline');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const base64url = require('base64url');
const { HttpsProxyAgent } = require('https-proxy-agent');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

const colors = [
    '\x1b[91m',
    '\x1b[94m',
    '\x1b[92m',
    '\x1b[95m',
    '\x1b[93m',
    '\x1b[96m'
];

const countries = ["United States", "Canada", "Germany", "France", "Japan", "India"];
const mobileNames = ["iPhone 13", "Samsung Galaxy S21", "Google Pixel 6", "OnePlus 9", "Sony Xperia 5"];

let stats = {
    total: 0,
    sent: 0,
    errors: 0,
    inbox: 0,
    spam: 0
};

function getRandomAlpha(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getRandomNum(length) {
    const chars = '0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getRandomIP() {
    const getRandomByte = () => Math.floor(Math.random() * 256);
    return `${getRandomByte()}.${getRandomByte()}.${getRandomByte()}.${getRandomByte()}`;
}

function getRandomCountry() {
    return countries[Math.floor(Math.random() * countries.length)];
}

function getRandomMobileName() {
    return mobileNames[Math.floor(Math.random() * mobileNames.length)];
}

function getRandomLink(links) {
    return links[Math.floor(Math.random() * links.length)];
}

function replaceTags(content, email, imagePath, link) {
    const recipientName = email.split('@')[0];
    const emailDomain = email.split('@')[1];
    const emailRootDomain = emailDomain.split('.')[0];
    const emailProvider = emailDomain.split('.').slice(-2).join('.');
    const currentDate = new Date().toLocaleDateString();
    const currentTime = new Date().toLocaleTimeString();

    return content
        .replace(/#EMAIL/g, email)
        .replace(/#USER/g, recipientName)
        .replace(/#DOMC/g, emailProvider)
        .replace(/#DOMs/g, emailRootDomain)
        .replace(/#DOMAIN/g, emailDomain)
        .replace(/#ALPHA/g, getRandomAlpha(1))
        .replace(/#ALPHA3/g, getRandomAlpha(3))
        .replace(/#ALPHA5/g, getRandomAlpha(5))
        .replace(/#NUM/g, getRandomNum(1))
        .replace(/#NUM3/g, getRandomNum(3))
        .replace(/#NUM5/g, getRandomNum(5))
        .replace(/#MD5/g, crypto.randomBytes(16).toString('hex'))
        .replace(/#BASE64EMAIL/g, base64url(email))
        .replace(/{currentDate}/g, currentDate)
        .replace(/{currentTime}/g, currentTime)
        .replace(/{currentDateTime}/g, `${currentDate} ${currentTime}`)
        .replace(/#IP/g, getRandomIP())
        .replace(/#COUNTRY/g, getRandomCountry())
        .replace(/#MOBILE/g, getRandomMobileName())
        .replace(/#LINK/g, link)
        .replace(/#IMAGE/g, imagePath ? `<img src="cid:image"/>` : '');
}

/*function printLogo() {
    const clear = '\x1b[0m';
    const YearMonthDay = new Date().toISOString().slice(0, 10);
    const x = `
================================FIXER SENDER V10============================================
        _____               [+] Best Sender Tool                                          [+]
    .-,;='';_),-.           [+] Think Twice , Code Once                                   [+]
     \\_\\(),()/_/            [+] Multi Thread                                              [+]
       (,___,)              [+] Random SMTPs                                              [+]
      ,-/\`~\`\\-,___          [+] Version : 10                                              [+]
     / /).:.('--._)         [+] Website : Mikaoffical.com                                 [+]
    {_[ (_,_)               [+] Active  : Yes                                             [+]
        | Y |               [+] Date    : ${YearMonthDay}                                 [+]
       /  |  \\              [+] Channel : @FixerWorld                                     [+]
                            [+] Owner   : @MrFixer Admin                                  [+]
===========================================================================================
`;
    x.split('\n').forEach((line, index) => {
        console.log(colors[index % colors.length] + line + clear);
        setTimeout(() => {}, 50);
    });
}*/

function createProxyAgent(proxy) {
    const parts = proxy.split(':');
    if (parts.length === 2) {
        // No authentication
        const [host, port] = parts;
        return new HttpsProxyAgent(`http://${host}:${port}`);
    } else if (parts.length === 4) {
        // With authentication
        const [host, port, username, password] = parts;
        return new HttpsProxyAgent(`http://${username}:${password}@${host}:${port}`);
    } else {
        throw new Error('Invalid proxy format');
    }
}

async function sendEmail(site, successCount, totalEmails, smtpIndex, nameIndex, subjectIndex, subjects, basePath, imagePath, smtpLimits, smtpUsage, io, proxyAgent, pdfAttachmentPath, links, useLinks, config) {
    const smtpPath = path.join(basePath, 'smtp.txt');
    const smtps = fs.readFileSync(smtpPath, 'utf8')
        .trim()
        .split('\n')
        .map(line => {
            const [host, port, user, pass] = line.split('|');
            return { host, port, user, pass };
        });

    const namePath = path.join(basePath, 'Name.txt');
    const names = fs.readFileSync(namePath, 'utf8').trim().split('\n');
    const fromName = names[nameIndex % names.length];

    let success = false;
    let attempts = 0;
    const maxAttempts = smtps.length;

    while (!success && attempts < maxAttempts) {
        let smtpConfig = smtps[smtpIndex % smtps.length];
        const smtpKey = `smtp${smtpIndex + 1}`; // Key format in config.json

        // Check SMTP limits
        if (smtpUsage[smtpKey] >= smtpLimits[smtpKey]) {
            console.log(`SMTP limit reached for ${smtpConfig.host}. Skipping to next SMTP.`);
            smtpIndex = (smtpIndex + 1) % smtps.length;
            attempts++;
            continue;
        }

        const transporterConfig = {
            host: smtpConfig.host,
            port: smtpConfig.port,
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
            },
        };

        if (proxyAgent) {
            transporterConfig.agent = proxyAgent;
        }

        const transporter = nodemailer.createTransport(transporterConfig);

        const currentDate = new Date().toLocaleDateString();
        const currentTime = new Date().toLocaleTimeString();
        const subject = subjects[subjectIndex % subjects.length];
        const modifiedSubject = `${subject} - ${currentDate} ${currentTime}`;

        const letterPath = path.join(basePath, 'letter.txt');
        let letterContent = fs.readFileSync(letterPath, 'utf8').trim();
        const link = useLinks ? getRandomLink(links) : '';
        letterContent = replaceTags(letterContent, site, config.embeddedImage.enabled && imagePath ? imagePath : null, link);

        const attachments = [];
        if (config.embeddedImage.enabled && imagePath) {
            attachments.push({
                filename: 'image.jpg',
                path: imagePath,
                cid: 'image'
            });
        }
        if (pdfAttachmentPath) {
            attachments.push({
                filename: 'attachment.pdf',
                path: pdfAttachmentPath
            });
        }

        const mailOptions = {
            from: `CloudDrive<dmorioka@legacyhc.com>`,
            to: site,
            subject: modifiedSubject,
            text: letterContent,
            html: letterContent,
            attachments: attachments
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log('\x1b[92mEmail Sent: ' + site + '\x1b[0m');
            fs.appendFileSync('Sent.txt', `${site}\n`);
            successCount.count++;
            smtpUsage[smtpKey] = (smtpUsage[smtpKey] || 0) + 1;

            // Simulate inbox/spam detection (for example purposes, this should be replaced with actual detection logic)
            if (Math.random() < 0.8) {
                stats.inbox++;
            } else {
                stats.spam++;
            }

            if (successCount.count === totalEmails) {
                console.log('\x1b[92mAll emails sent successfully \x1b[0m');
            }

            success = true;
            io.emit('log', `Email Sent: ${site}`);
        } catch (err) {
            console.error(`Error with ${smtpConfig.host}: ${err.message}`);
            fs.appendFileSync('smtperror.txt', `${smtpConfig.host} - ${err.message}\n`);
            smtpIndex = (smtpIndex + 1) % smtps.length;
            attempts++;
            stats.errors++;
            io.emit('log', `Error with ${smtpConfig.host}: ${err.message}`);

            // Check if the error is related to the proxy
            if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.message.includes('Proxy')) {
                console.log('\x1b[91mProxy is dead. Changing proxy...\x1b[0m');
                if (proxyAgent) {
                    const proxies = fs.readFileSync(path.join(basePath, 'proxys.txt'), 'utf8').trim().split('\n');
                    const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
                    proxyAgent = createProxyAgent(randomProxy);
                }
            }
        }

        stats.sent = successCount.count;
        stats.total = totalEmails;

        io.emit('update', stats);
    }
}
/*
async function sendTestEmail(testEmail, smtpConfig, fromName, subject, basePath, imagePath, proxyAgent, pdfAttachmentPath, link, config) {
    try {
        const transporterConfig = {
            host: smtpConfig.host,
            port: smtpConfig.port,
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass
            },
        };

        if (proxyAgent) {
            transporterConfig.agent = proxyAgent;
        }

        const transporter = nodemailer.createTransport(transporterConfig);

        const currentDate = new Date().toLocaleDateString();
        const currentTime = new Date().toLocaleTimeString();
        const modifiedSubject = `${subject} - ${currentDate} ${currentTime}`;

        const letterPath = path.join(basePath, 'letter.txt');
        let letterContent = fs.readFileSync(letterPath, 'utf8').trim();
        letterContent = replaceTags(letterContent, testEmail, config.embeddedImage.enabled ? imagePath : null, link);

        const attachments = [];
        if (config.embeddedImage.enabled && imagePath) {
            attachments.push({
                filename: 'image.jpg',
                path: imagePath,
                cid: 'image'
            });
        }
        if (pdfAttachmentPath) {
            attachments.push({
                filename: 'attachments.pdf',
                path: pdfAttachmentPath
            });
        }

        /* const mailOptions = {
            from: ``,
            to: testEmail,
            subject: modifiedSubject,
            text: letterContent,
            html: letterContent,
            attachments: attachments
        };*/

    /*    await transporter.sendMail(mailOptions);
        console.log('\x1b[94mTest Email Sent to: ' + testEmail + '\x1b[0m');
    } catch (err) {
        console.error(`Error sending test email: ${err}`);
        // Check if the error is related to the proxy
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.message.includes('Proxy')) {
            console.log('\x1b[91mProxy is dead. Changing proxy...\x1b[0m');
            if (proxyAgent) {
                const proxies = fs.readFileSync(path.join(basePath, 'proxys.txt'), 'utf8').trim().split('\n');
                const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
                proxyAgent = createProxyAgent(randomProxy);
            }
        }
    }
} */

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, testingMode, imagePath, io, proxyAgent, pdfAttachmentPath, links, useLinks, config) {
    let successCount = { count: 0 };
    let smtpIndex = 0;
    let nameIndex = 0;
    let subjectIndex = 0;

    const smtpPath = path.join(basePath, 'smtp.txt');
    const smtps = fs.readFileSync(smtpPath, 'utf8')
        .trim()
        .split('\n')
        .map(line => {
            const [host, port, user, pass] = line.split('|');
            return { host, port, user, pass };
        });

    const namePath = path.join(basePath, 'Name.txt');
    const names = fs.readFileSync(namePath, 'utf8').trim().split('\n');

    const smtpLimits = JSON.parse(fs.readFileSync(path.join(basePath, 'config.json'), 'utf8')).smtpLimits;
    const smtpUsage = {};

    stats.total = emailList.length;

    // Open the panel when sending starts
    /*const open = await import('open');
    open.default('http://localhost:3000');*/

    for (let i = 0; i < emailList.length; i += batchSize) {
        const batch = emailList.slice(i, i + batchSize);
        const promises = batch.map(async (email) => {
            const smtpConfig = smtps[smtpIndex % smtps.length];
            const fromName = names[nameIndex++ % names.length];
            const subject = subjects[subjectIndex++ % subjects.length];
            await sendEmail(email, successCount, totalEmails, smtpConfig, fromName, subject, basePath, imagePath, smtpUsage, io, proxyAgent, pdfAttachmentPath, links, useLinks, config);
            // Rotate SMTP index for next email
            smtpIndex = (smtpIndex + 1) % smtps.length;
        });

       await Promise.all(promises); // Wait for all emails in the batch to be sent
        console.log(`Batch completed. Waiting for ${batchDelayMs / 1000} seconds...`);
        await delay(batchDelayMs); // Keep the batch delay


        if (selectedMode === '2' && (i + batchSize) % 500 === 0) {
            const smtpConfig = smtps[smtpIndex % smtps.length];
            const fromName = names[nameIndex % names.length];
            const link = useLinks ? getRandomLink(links) : '';
            await sendTestEmail(testEmail, smtpConfig, fromName, subjects[subjectIndex % subjects.length], basePath, config.embeddedImage.enabled ? imagePath : null, proxyAgent, pdfAttachmentPath, link, config);
        }
        if (testingMode && i + batchSize >= testingMode) {
            console.log(`\x1b[95mTesting Mode: Sent ${testingMode} emails. Stopping.\x1b[00m`);
            break;
        }
    }
}

//printLogo();

// Set up the Express server and Socket.io
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname)); // Serve static files from the current directory

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(3000);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const basePath = path.join(__dirname, 'Fixer Sender');

function choose(basePath) {
    const choice = colors[Math.floor(Math.random() * colors.length)];

    const config = JSON.parse(fs.readFileSync(path.join(basePath, 'config.json'), 'utf8'));

    rl.question(`${choice}Select Mode:\n\n  [1] Default Mode\n  [2] Office 365 Marketing Mode\n  [3] Testing Mode\n\n  [?] Select a mode by entering the corresponding number: \x1b[00m`, (selectedMode) => {
        if (selectedMode === '1' || selectedMode === '2' || selectedMode === '3') {
            rl.question(`${choice}[?] Enter Emails List : \x1b[00m`, (EmailList) => {
                const subjectPath = path.join(basePath, 'Subject.txt');
                const subjects = fs.readFileSync(subjectPath, 'utf8').trim().split('\n');
                const emailListPath = path.join(basePath, EmailList);
                const emailList = fs.readFileSync(emailListPath, 'utf8').split('\n').map(line => line.trim()).filter(line => line);

                const totalEmails = emailList.length;
                let delayMs, batchDelayMs, batchSize;
                let pdfAttachmentPath = null;

                let proxyAgent = null;
                if (config.proxy.enabled) {
                    const proxies = fs.readFileSync(path.join(basePath, 'proxys.txt'), 'utf8').trim().split('\n');
                    const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
                    proxyAgent = createProxyAgent(randomProxy);
                }

                let links = [];
                if (config.links.enabled) {
                    const linksPath = path.join(basePath, 'link.txt');
                    links = fs.readFileSync(linksPath, 'utf8').trim().split('\n');
                }

                if (selectedMode === '1') {
                    // Default mode from config.json
                    delayMs = config.defaultMode.delayMs;
                    batchDelayMs = config.defaultMode.batchDelayMs;
                    batchSize = config.defaultMode.batchSize;
                } else if (selectedMode === '2') {
                    // Office 365 Marketing mode from config.json
                    delayMs = config.office365MarketingMode.delayMs;
                    batchDelayMs = config.office365MarketingMode.batchDelayMs;
                    batchSize = config.office365MarketingMode.batchSize;

                    rl.question(`${choice}[?] Enter Test Email Address for Office 365 Mode: \x1b[00m`, (testEmail) => {
                        rl.question(`${choice}[?] Do you want to include an Image? (yes/no): \x1b[00m`, (includeImage) => {
                            if (includeImage.toLowerCase() === 'yes') {
                                rl.question(`${choice}[?] Enter image path: \x1b[00m`, (imagePath) => {
                                    if (config.attachments.enabled) {
                                        rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                            if (includePdf.toLowerCase() === 'yes') {
                                                rl.question(`${choice}[?] Enter PDF attachment Name: \x1b[00m`, (pdfPath) => {
                                                    pdfAttachmentPath = pdfPath;
                                                    sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, imagePath, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                                        console.log('All emails processed.');
                                                        rl.close();
                                                    }).catch(err => {
                                                        console.error('Error sending emails:', err);
                                                        rl.close();
                                                    });
                                                });
                                            } else {
                                                sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                                    console.log('All emails processed.');
                                                    rl.close();
                                                }).catch(err => {
                                                    console.error('Error sending emails:', err);
                                                    rl.close();
                                                });
                                            }
                                        });
                                    } else {
                                        sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                            console.log('All emails processed.');
                                            rl.close();
                                        }).catch(err => {
                                            console.error('Error sending emails:', err);
                                            rl.close();
                                        });
                                    }
                                });
                            } else {
                                if (config.attachments.enabled) {
                                    rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                        if (includePdf.toLowerCase() === 'yes') {
                                            rl.question(`${choice}[?] Enter PDF attachment path: \x1b[00m`, (pdfPath) => {
                                                pdfAttachmentPath = pdfPath;
                                                sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, null, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                                    console.log('All emails processed.');
                                                    rl.close();
                                                }).catch(err => {
                                                    console.error('Error sending emails:', err);
                                                    rl.close();
                                                });
                                            });
                                        } else {
                                            sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                                console.log('All emails processed.');
                                                rl.close();
                                            }).catch(err => {
                                                console.error('Error sending emails:', err);
                                                rl.close();
                                            });
                                        }
                                    });
                                } else {
                                    sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, testEmail, null, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                        console.log('All emails processed.');
                                        rl.close();
                                    }).catch(err => {
                                        console.error('Error sending emails:', err);
                                        rl.close();
                                    });
                                }
                            }
                        });
                    });

                    return;
                } else if (selectedMode === '3') {
                    // Testing mode
                    delayMs = config.testingMode.delayMs;
                    batchDelayMs = config.testingMode.batchDelayMs;
                    batchSize = config.testingMode.batchSize;

                    rl.question(`${choice}[?] Enter number of test emails to send: \x1b[00m`, (numTestEmails) => {
                        const testingMode = parseInt(numTestEmails, 10);
                        if (isNaN(testingMode) || testingMode <= 0) {
                            console.log('\x1b[95mInvalid number of test emails. Please enter a positive integer.\x1b[00m');
                            choose(basePath);
                            return;
                        }

                        rl.question(`${choice}[?] Do you want to include an image? (yes/no): \x1b[00m`, (includeImage) => {
                            if (includeImage.toLowerCase() === 'yes') {
                                rl.question(`${choice}[?] Enter image path: \x1b[00m`, (imagePath) => {
                                    if (config.attachments.enabled) {
                                        rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                            if (includePdf.toLowerCase() === 'yes') {
                                                rl.question(`${choice}[?] Enter PDF attachment path: \x1b[00m`, (pdfPath) => {
                                                    pdfAttachmentPath = pdfPath;
                                                    sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, imagePath, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                                        console.log('All test emails processed.');
                                                        rl.close();
                                                    }).catch(err => {
                                                        console.error('Error sending test emails:', err);
                                                        rl.close();
                                                    });
                                                });
                                            } else {
                                                sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                                    console.log('All test emails processed.');
                                                    rl.close();
                                                }).catch(err => {
                                                    console.error('Error sending test emails:', err);
                                                    rl.close();
                                                });
                                            }
                                        });
                                    } else {
                                        sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                            console.log('All test emails processed.');
                                            rl.close();
                                        }).catch(err => {
                                            console.error('Error sending test emails:', err);
                                            rl.close();
                                        });
                                    }
                                });
                            } else {
                                if (config.attachments.enabled) {
                                    rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                        if (includePdf.toLowerCase() === 'yes') {
                                            rl.question(`${choice}[?] Enter PDF attachment path: \x1b[00m`, (pdfPath) => {
                                                pdfAttachmentPath = pdfPath;
                                                sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, null, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                                    console.log('All test emails processed.');
                                                    rl.close();
                                                }).catch(err => {
                                                    console.error('Error sending test emails:', err);
                                                    rl.close();
                                                });
                                            });
                                        } else {
                                            sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                                console.log('All test emails processed.');
                                                rl.close();
                                            }).catch(err => {
                                                console.error('Error sending test emails:', err);
                                                rl.close();
                                            });
                                        }
                                    });
                                } else {
                                    sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, testingMode, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                        console.log('All test emails processed.');
                                        rl.close();
                                    }).catch(err => {
                                        console.error('Error sending test emails:', err);
                                        rl.close();
                                    });
                                }
                            }
                        });
                    });

                    return;
                }

                rl.question(`${choice}[?] Do you want to include an image? (yes/no): \x1b[00m`, (includeImage) => {
                    if (includeImage.toLowerCase() === 'yes') {
                        rl.question(`${choice}[?] Enter image path: \x1b[00m`, (imagePath) => {
                            if (config.attachments.enabled) {
                                rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                    if (includePdf.toLowerCase() === 'yes') {
                                        rl.question(`${choice}[?] Enter PDF attachment path: \x1b[00m`, (pdfPath) => {
                                            pdfAttachmentPath = pdfPath;
                                            sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, imagePath, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                                console.log('All emails processed.');
                                                rl.close();
                                            }).catch(err => {
                                                console.error('Error sending emails:', err);
                                                rl.close();
                                            });
                                        });
                                    } else {
                                        sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                            console.log('All emails processed.');
                                            rl.close();
                                        }).catch(err => {
                                            console.error('Error sending emails:', err);
                                            rl.close();
                                        });
                                    }
                                });
                            } else {
                                sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, imagePath, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                    console.log('All emails processed.');
                                    rl.close();
                                }).catch(err => {
                                    console.error('Error sending emails:', err);
                                    rl.close();
                                });
                            }
                        });
                    } else {
                        if (config.attachments.enabled) {
                            rl.question(`${choice}[?] Do you want to include a PDF attachment? (yes/no): \x1b[00m`, (includePdf) => {
                                if (includePdf.toLowerCase() === 'yes') {
                                    rl.question(`${choice}[?] Enter PDF attachment path: \x1b[00m`, (pdfPath) => {
                                        pdfAttachmentPath = pdfPath;
                                        sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, null, io, proxyAgent, pdfAttachmentPath, links, config.links.enabled, config).then(() => {
                                            console.log('All emails processed.');
                                            rl.close();
                                        }).catch(err => {
                                            console.error('Error sending emails:', err);
                                            rl.close();
                                        });
                                    });
                                } else {
                                    sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                        console.log('All emails processed.');
                                        rl.close();
                                    }).catch(err => {
                                        console.error('Error sending emails:', err);
                                        rl.close();
                                    });
                                }
                            });
                        } else {
                            sendEmailsWithDelays(emailList, basePath, subjects, totalEmails, delayMs, batchDelayMs, batchSize, selectedMode, null, null, null, io, proxyAgent, null, links, config.links.enabled, config).then(() => {
                                console.log('All emails processed.');
                                rl.close();
                            }).catch(err => {
                                console.error('Error sending emails:', err);
                                rl.close();
                            });
                        }
                    }
                });
            });
        } else {
            console.log('\x1b[95mInvalid mode selected. Please choose 1, 2, or 3.\x1b[00m');
            choose(basePath);
        }
    });
}

choose(basePath);
