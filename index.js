'use strict';
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json());
var requestify = require('requestify');
var config = require('./config');
var models = require('./db/models');
var jwt = require('jsonwebtoken');

var User = models.User;
var Relation = models.Relation;

var http = require('http').Server(app);
var io = require('socket.io')(http);

var findUserByVkId = (vkId) => {
    return User.findOne({vkId});
};

var getUserInfo = (vkId) => {
    return new Promise((resolve, reject) => {
        requestify.get(`http://api.vkontakte.ru/method/users.get?uids=${vkId}&fields=photo_100,photo_200,contacts,status`)
            .then(res => {
                var body = JSON.parse(res.body);
                var result = body.response;
                var error = body.error;
                if(result) resolve(result[0]);
                if(error)resolve(error);
            })
    })
};

var getUserFriends = (vkId, count, offset) => {
    return new Promise((resolve, reject) => {
        requestify.get(`http://api.vkontakte.ru/method/friends.get?user_id=${vkId}&order=random&fields=photo_100`)
            .then(res => {
                var body = JSON.parse(res.body);
                var result = body.response;
                var error = body.error;
                console.log('Import friends:', result);
                if(result) resolve(result);
                if(error)resolve(error);
            })
    })
};

var importVkUser = (vkId) => {
    return getUserInfo(vkId)
        .then(userObject => {
            var newUserObject = {
                vkId: userObject.uid,
                firstName: userObject.first_name,
                lastName: userObject.last_name,
                photo100: userObject.photo_100,
                photo200: userObject.photo_200,
                latitude: null,
                longitude: null,
                status: 1
            };
            var newUser = new User(newUserObject);
            return newUser.save();
        })
};

app.use('/api/*', function (req, res, next) {
    var token = req.body.token;
    try {
        var user = jwt.verify(token, config.secret);
        delete req.token;
        req.user = user._doc;
        next()
    }
    catch (err) {
        res.json({success: false, code: 400});
    }
});

app.get('/', (req,res) => {
    res.send('Marauders map is online');
});

app.post('/api/stop-follow', (req, res) => {
    var user = req.user;
    var following = req.body.vkId;
    Relation.findOne({following, follower: user.vkId})
        .then(relation => relation.remove())
        .then(() => res.json({success: true}))
        .catch(err => console.log('Error stop follow:', err))
});

app.post('/api/follow', (req, res) => {
    var user = req.user;
    var following = req.body.vkId;
    var newRelation = new Relation({
        following,
        follower: user.vkId
    });
    newRelation.save()
        .then(result => {
            console.log(result);
            res.json({success: true, data: result});
        })
        .catch(err => console.log(err));
});

app.post('/api/import-friends', (req, res) => {
    var user = req.user;
    var count = req.body.count;
    var offset = req.body.offset;
    getUserFriends(user.vkId, count, offset)
        .then((result) => {
            if(result) return res.json({success: 1, data: result})
        })
        .catch(err => console.log('Import user friends error:', err));
});

app.post('/api/followers', (req, res) => {
    var user = req.user;
    Relation.find({
        following: user.vkId
    })
        .then(result => {
            var mappedResult = result.map(relation => relation.follower);
            console.log('Followers: \n', mappedResult);
            return res.json({success: true, data: mappedResult});
        })
        .catch(err => {
            console.log(err);
            return res.json({success: false})
        });

});

app.post('/api/following', (req, res) => {
    var user = req.user;
    Relation.find({
        follower: user.vkId
    })
        .then(result => {
            var mappedResult = result.map(relation => relation.following);
            console.log('Following: \n', mappedResult);
            return res.json({success: true, data: mappedResult});
        })
        .catch(err => {
            console.log(err);
            return res.json({success: false})
        });

});

app.post('/user/get/token', (req, res) => {
    var token = req.body.token;
    if(!token) return res.json({success: false, code: 400});
    try {
        var data = jwt.verify(token, config.secret);
        data = data._doc;
        findUserByVkId(data.vkId)
            .then(user => {
                if(!user){
                    var vkId = data.vkId;
                    return importVkUser(vkId)
                        .then(user => {
                            console.log('Saved user:', user.firstName, user.lastName);
                            var token = jwt.sign(user, config.secret, {
                                expiresIn: '365d'
                            });
                            var response = {
                                firstName: user.firstName,
                                lastName: user.lastName,
                                vkId: user.vkId,
                                photo100: user.photo100,
                                photo200: user.photo200,
                                latitude: user.latitude,
                                longitude: user.longitude,
                                status: user.status,
                                token: token
                            };
                            res.json({success: true, data: response});
                        })
                        .catch(err => console.log('saving user failed:', err));
                }
                var newToken = jwt.sign(user, config.secret, {
                    expiresIn: '365d'
                });
                var updatedUser = Object.assign({}, user)._doc;
                updatedUser.token = newToken;
                return res.json({success:true, data: updatedUser});
            })
            .catch(err => {
                console.log(err);
                return res.json({success:false, error: 400});
            });
    } catch(err) {
        return res.json({success: false, code: 400});
    }
});

app.post('/vk-auth', (req, res) => {
    requestify.get(`https://oauth.vk.com/access_token?client_id=${config.vkClientId}&client_secret=${config.vkClientSecret}&redirect_uri=http://vk.com&code=${req.body.code}`, {
        method: 'get'
    })
        .then(response => {
            var body = JSON.parse(response.body);
            if(body.user_id){
                return findUserByVkId(body.user_id)
                    .then(user => {
                        if(!user){
                            console.log('user not found');
                            return importVkUser(body.user_id)
                                .then(user => {
                                    console.log('Saved user:', user.firstName, user.lastName);
                                    var token = jwt.sign(user, config.secret, {
                                        expiresIn: '365d'
                                    });
                                    var response = {
                                        firstName: user.firstName,
                                        lastName: user.lastName,
                                        vkId: user.vkId,
                                        photo100: user.photo100,
                                        photo200: user.photo200,
                                        latitude: user.latitude,
                                        longitude: user.longitude,
                                        status: user.status,
                                        token: token
                                    };
                                    res.json({success: true, data: response});
                                })
                                .catch(err => console.log('saving user failed:', err));
                        }
                        console.log('User found:', user.firstName, user.lastName);
                        var token = jwt.sign(user, config.secret, {
                            expiresIn: '365d'
                        });
                        var response = {
                            firstName: user.firstName,
                            lastName: user.lastName,
                            vkId: user.vkId,
                            photo100: user.photo100,
                            photo200: user.photo200,
                            latitude: user.latitude,
                            longitude: user.longitude,
                            status: user.status,
                            token: token
                        };
                        res.json({success: true, data: response});
                    });
            };
            res.json({success: true})
        })
        .catch(err => {
            console.log(err)
        })
});

io.on('connection', (socket) => {
    socket.on('disconnect', () => {
    });
    socket.on('test', () => {
    })
});

http.listen(3000, () => {
    console.log('Listening on port 3000');
});