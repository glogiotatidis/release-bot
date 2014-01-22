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
config.DEV = (typeof(config.DEV) === 'string' && config.DEV.toLowerCase() === 'true') || config.DEV === true;

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


irc.on('message', function(user, channel, message) {
    var regex = new RegExp('^' + config.realNick + '[:,]?');
    var command = message.split(regex)[1];

    if (command) {
        command = command.trim();
        if (command === 'can we release?') {
            query_bug_status(channel);
        }
        else if (command === 'will it blend?') {
            var blend_list = ['http://www.willitblend.com/videos/avocados',
                              'http://www.willitblend.com/videos/healthy-green-drink',
                              'http://www.willitblend.com/videos/ice-into-snow',
                              'http://www.willitblend.com/videos/coffee',
                              'http://www.willitblend.com/videos/paintballs',
                              'http://www.willitblend.com/videos/credit-cards'];
            var link = blend_list[Math.floor(Math.random() * blend_list.length)];
            irc.say(channel, 'Of course it will ' + user + '! ' + link);
        }
    }
});


function query_bug_status(channel) {
    bugzilla.searchBugs({version: 'next',
                         component: ircChannels[channel].component,
                         product: ircChannels[channel].product},
                         function(error, bug_list) {
                             if (bug_list && bug_list.length === 0) {
                                 irc.say(channel, 'No bugs waiting for release.');
                                 return;
                             }
                             var open_bugs = [];
                             var unverified_bugs = [];
                             var verified_bugs = [];

                             for (var index in bug_list) {
                                 var bug = bug_list[index];
                                 if (bug.resolution !== 'FIXED') {
                                     // irc.say(channel, 'Bug' + bug.id + ' is not FIXED');
                                     open_bugs.push(bug);
                                 }
                                 else if (bug.status !== 'VERIFIED' && bug.whiteboard.indexOf('qa-') === -1) {
                                     // irc.say(channel, 'Bug ' + bug.id + ' needs verification');
                                     unverified_bugs.push(bug);
                                 }
                                 else {
                                     verified_bugs.push(bug);
                                 }
                             }
                             irc.say(channel, ('There are ' + verified_bugs.length + ' verified bugs, ' +
                                               unverified_bugs.length + ' unverified bugs and ' +
                                               open_bugs.length + ' open bugs on version "next".'));
                             if (verified_bugs.length == bug_list.length) {
                                 irc.say(channel, 'Yes we can!');
                             }
                             else {
                                 irc.say(channel, 'Not yet!');
                             }
                        });
}

function tag_bug(bugNumber) {
    bugzilla.getBug(bugNumber, function(error, bug) {
        if (!error) {
            bugzilla.updateBug(
                bugNumber,
                {'version': 'next',
                 'token': bug.update_token},
                function(error, bug) {
                    if (error) {
                        var message = 'Error tagging bug ' + bugNumber;
                    }
                    else {
                        var message = 'Tagging bug ' + bugNumber;
                    }
                    for (var channel in ircChannels) {
                        if (ircChannels[channel].repo === data.repository.url) {
                            irc.say(channel, message);
                            break;
                        }
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
    var bug_list = [];
    var data = JSON.parse(request.body.payload);
    if (data.ref !== 'refs/heads/master') {
        console.log('Not tagging because commit not in master.');
    }
    else {
        var bug_re = /fix bug (\d{6,7})/g;
        for (var commit in data.commits) {
            var message = data.commits[commit].message.toLowerCase();
            if (bug_re.test(message)) {
                // We must explicitly reset lastIndex for the next
                // match to happen. This is a known ES bug.
                bug_re.lastIndex = 0;
                var matches = message.match(bug_re);
                for (var index in matches) {
                    var bug = matches[index].match(/\d+/)[0];
                    // Check if bug has been tagged already during
                    // this request.
                    if (bug_list.indexOf(bug) > -1) {
                        continue;
                    }
                    bug_list.push(bug);
                    if (!config.DEV) {
                        tag_bug(bug);
                    }
                    else {
                        var irc_message = 'Tagging bug ' + bug;
                        for (var channel in ircChannels) {
                            if (ircChannels[channel].repo === data.repository.url) {
                                irc.say(channel, irc_message);
                                break;
                            }
                        }
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
