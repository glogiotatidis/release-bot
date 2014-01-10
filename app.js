'use strict';

var IRC = require('irc');
var bz = require('bz');
var express = require('express');
var app = express();
var nconf = require('nconf');

nconf.argv().env().file({ file: './local.json'}).defaults({
    PORT: 3000,
    nick: 'release-bot',
    DEV: false
});

var config = nconf.get();
config.DEV = (typeof(config.DEV) === 'string' && config.DEV.toLowerCase() === 'true') || config.DEV === true

if ((config.BUGZILLA_USERNAME === undefined || config.BUGZILLA_PASSWORD === undefined) && (!config.DEV)) {
    console.error('Set bugzilla username and password first.');
    process.exit(1);
}


var ircChannels = require('./irc_channels.json');
if (config.DEV) {
  ircChannels = require('./irc_channels_dev.json');
}

console.log(Object.keys(ircChannels));
    
var irc = new IRC.Client('irc.mozilla.org', config.nick, {
    secure: true,
    port: 6697,
    userName: config.nick,
    realName: 'Release Helper Bot',
    channels: Object.keys(ircChannels)
});

// via https://github.com/mythmon/standup-irc/blob/master/standup-irc.js
// Connected to IRC server
irc.on('registered', function(message) {
    console.log('Connected to IRC server.');
    // Store the nickname assigned by the server
    config.realNick = message.args[0];
    console.info('Using nickname: ' + config.realNick);
});

/// Express
app.use(express.bodyParser());
var data = 'Not much here.';

app.get('/', function(request, response) {
    response.send(data);
});


var bugzilla = bz.createClient({
    url: 'https://api-dev.bugzilla.mozilla.org/latest/',
    username: config.BUGZILLA_USERNAME,
    password: config.BUGZILLA_PASSWORD,
    timeout: 30000
});

function tag_bug(bugNumber) {
    bugzilla.getBug(bugNumber, function(error, bug) {
        if (!error) {
            bugzilla.updateBug(
                bugNumber,
                {'version': 'next',
                 'token': bug.update_token},
                function(error, bug) {
                    if (error) {
                        console.log('Error updating');
                        console.log(error);
                    }
                    else {
                        console.log('all ok!');
                        console.log(bug);
                    }
                }
            );
        }
        else {
            console.log('Error geting bug', error);
        }
    });
}


app.post('/', function(request, response) {
    data = JSON.parse(request.body.payload);
    if (data.ref !== 'refs/heads/master') {
        console.log('Not tagging because commit not in master.');
    }
    else {
        var bug_re = /fix bug (\d{6,7})/g;
        for (var commit in data.commits) {
            var message = data.commits[commit].message.toLowerCase();
            if (bug_re.test(message)) {
                var matches = message.match(bug_re);
                for (var index in matches) {
                    var bug = matches[index].match(/\d+/)[0];
                    for (var channel in ircChannels) {
                        if (ircChannels[channel].repo === data.repository.url) {
                            message = 'Tagging bug ' + bug;
                            irc.say(channel, message);
                            break;
                        }
                    }
                    if (!config.DEV) {
                        tag_bug(bug);
                    }
                }
            }
        }
    }
    response.send('OK');
});


if (!module.parent) {
    app.listen(config.PORT);
    console.log('Express server listening on port ' + config.PORT);
}
