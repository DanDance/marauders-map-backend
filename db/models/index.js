var mongoose = require('mongoose');
mongoose.connect('mongodb://localhost/marauders-map');

var user = new mongoose.Schema({
    firstName: { type : String, required : true},
    lastName: { type : String, required : true},
    vkId: { type : String, unique: true, required : true},
    photo100: { type : String, required : true},
    photo200: { type : String, required : true},
    mobileNumber: { type : String, required : false},
    latitude: { type : Number, required : false},
    longitude: { type : Number, required : false},
    status: { type : Number, required : true}, // 0 - Offline, 1 - Looking for, 2 - Have
});

var relation = mongoose.Schema({
    follower: { type : String, required : true}, // vk id 
    following: { type : String, required : true},  // vk id 
});

relation.index({ follower: 1, following: 1 }, { unique: true });

module.exports.Relation  = mongoose.model('Relation', relation);
module.exports.User = mongoose.model('User', user);
