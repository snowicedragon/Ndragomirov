(function (w){
  "use strict";

  var isFirefox = self && self.port && self.port.emit;

  var that = w.twitchApi = _.extend({}, Backbone.Events);

  that.basePath = "https://api.twitch.tv/kraken";
  that.userName = "";

  var token;

  var providerOpts = {
    api          : "https://api.twitch.tv/kraken/oauth2/authorize",
    response_type: 'code',
    client_id    : 'b4sj5euottb8mm7pc1lfvi84kvzxqxk',
    client_secret: '2m42qpmxfy5l2ik4c93s0qco4vzfgr0',
    api_scope    : 'user_follows_edit user_read',
    redirect_uri : 'http://ndragomirov.github.io/twitch.html'
  };

  that.listen = function (){
    if ( isFirefox ) {
      self.port.on("OAUTH2_TOKEN", function (accessToken){
        token = accessToken;
        if ( token ) {
          that.trigger("authorize");
        }
      })
      self.port.emit("OAUTH2_TOKEN");
    } else {

      chrome.runtime.onMessage.addListener(function (msg){
        if ( msg.id == "OAUTH2_TOKEN" ) {
          token = msg.value;
          if ( token ) {
            that.trigger("authorize");
          }
        }
      })

      chrome.runtime.sendMessage({id: "OAUTH2_TOKEN_GET"});
    }
  }

  that.listen();

  that.getRequestParams = function (){
    return {
      timeout : 10 * 1000,
      dataType: "json",
      headers : {
        "Accept"       : "application/vnd.twitchtv.v2+json",
        "Client-ID"    : providerOpts.client_id,
        "Authorization": " OAuth " + token
      }
    };
  }

  that.revoke = function (){
    if ( isFirefox ) {
      self.port.emit("OAUTH2_REVOKE");
    } else {
      chrome.runtime.sendMessage({id: "OAUTH2_REVOKE"});
    }
    console.log("revoking");
    that.userName = "";
    that.trigger("revoke");
  };

  that.isAuthorized = function (){
    return !!token;
  };

  that.getUserName = function (cb){
    var userName = that.userName;
    var errMessage = "cant get current username";
    var req = {
      url: that.basePath + "/"
    };
    if ( userName ) return cb(null, userName);

    $.ajax($.extend(true, req, that.getRequestParams()))
      .fail(function (){
        return cb(errMessage);
      })
      .done(function (res){
        if ( !res.token.user_name ) {
          that.revoke();
          return cb(errMessage);
        }
        that.userName = userName = res.token.user_name;
        return cb(null, userName);
      });
  };

  that.authorize = function (){

    if ( isFirefox ) {
      self.port.emit("OAUTH2_AUTH");
    } else {
      chrome.runtime.sendMessage({id: "OAUTH2_AUTH"});
    }
  };

  that.getFollowed = function (cb){
    var reqCompleted = 0;
    var totalRequests = 4;
    var errors = 0;

    var liveStreams = [];

    var callback = function (err){
      reqCompleted++;
      if ( err ) errors++;
      if ( reqCompleted == totalRequests ) {
        if ( err > 0 ) {
          return cb("err");
        } else {
          return cb(null, {streams: liveStreams});
        }
      }
    }

    var getLiveStreams = function (res){
      return res.streams.filter(function (s){
        return s.hasOwnProperty("viewers");
      });
    }

    var getChannelIds = function (res){
      return res.follows.map(function (c){
        return c.channel.name;
      });
    }

    for ( var i = 0; i < totalRequests; i++ ) {
      var offset = i * 100;

      that.send("follows", {limit: 100, offset: offset}, function (err, res){
        if ( err ) return callback(err);
        var channels = getChannelIds(res);
        if ( channels == 0 ) return callback();

        that.send("streams", {limit: 100, channel: channels.join(",")}, function (err, res){
          if ( err ) return callback(err);
          liveStreams = liveStreams.concat(getLiveStreams(res));
          callback();
        });
      });
    }
  };

  that.send = function (methodName, opts, cb){

    var requestOpts = that[methodName]();

    var getUserName = requestOpts.url.match(/:user/) ?
      that.getUserName :
      function (fn){
        return fn()
      };

    if ( requestOpts.url.match(/:target/) ) {
      requestOpts.url = requestOpts.url.replace(/:target/, opts.target);
    }

    if ( requestOpts.url.match(/:channel/) ) {
      requestOpts.url = requestOpts.url.replace(/:channel/, opts.channel);
    }

    getUserName(function (err, userName){
      cb = cb || $.noop;
      if ( err ) return cb(err);
      requestOpts.url = that.basePath + requestOpts.url;
      requestOpts.url = requestOpts.url.replace(/:user/, userName);
      requestOpts = $.extend(true, requestOpts, {data: opts}, that.getRequestParams());
//      console.log(requestOpts);
      $.ajax(requestOpts)
        .done(function (data){
          that.trigger("done:" + methodName);
          cb(null, data);
        })
        .fail(function (xhr){
          console.log("\nStatus = ", xhr.status);
          //a workaround solution for twitch followed bug
          if ( xhr.status == 404 && methodName == "followed" ) {
            return that.getFollowed(cb);
          }
          if ( xhr.status == 401 ) {
            if ( token && token.length > 0) {
              that.revoke();
            }
          }
          that.trigger("fail:" + methodName);
          cb({err: "err" + methodName, status: xhr.status});
        })
    });

  };

  that.base = function (){
    return {
      type: "GET",
      url : "/"
    }
  };

  that.authUser = function (){
    return {
      type: "GET"
    }
  };

  that.user = function (){
    return {
      type: "GET",
      url : "/user"
    }
  };

  that.channelVideos = function (){
    return {
      type: "GET",
      url : "/channels/:channel/videos"
    }
  };

  that.searchStreams = function (){
    return {
      type: "GET",
      url : "/search/streams",
      data: {
        limit: 50
      }
    }
  };

  that.gamesTop = function (){
    return {
      type: "GET",
      url : "/games/top",
      data: {
        limit: 50
      }
    }
  };

  that.follows = function (){
    return {
      type : "GET",
      url  : "/users/:user/follows/channels",
      limit: 100
    }
  };

  that.follow = function (){
    return {
      type: "PUT",
      url : "/users/:user/follows/channels/:target"
    }
  };

  that.unfollow = function (){
    return {
      type: "DELETE",
      url : "/users/:user/follows/channels/:target"
    }
  };

  that.followed = function (){
    return {
      type: "GET",
      url : "/streams/followed",
      data: {
        limit: 100
      }
    }
  };

  that.streams = function (){
    return {
      type : "GET",
      url  : "/streams",
      limit: 50
    }
  };

})(this);