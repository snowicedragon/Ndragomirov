(function (){
  var root = this;
  var that = {};
  var isFirefox = !!root.require;
  var localStorage = isFirefox ? require("sdk/simple-storage").storage : root.localStorage;

  function noop(){
  }

  that._adapters = {};

  var request = function (opts, callback){
    if ( root.require ) {
      opts.method = opts.method.toLowerCase();
      var Request = require("sdk/request").Request;
      Request({
        url       : opts.url,
        content   : opts.data,
        onComplete: function (response){
          if ( response.status == 200 ) {
            callback(null, JSON.parse(response.text));
          } else {
            callback(response.status);
          }
        }
      })[opts.method]()
    }

    if ( root.jQuery ) {
      console.log("using jquery", opts);
      var $ = root.jQuery;
      $.ajax({
        url : opts.url,
        type: opts.method,
        data: opts.data
      })
        .always(function (data, textStatus, jqXHR){
          if ( textStatus == "success" ) {
            callback(null, data);
          } else {
            callback(data);
          }
        });
    }
  }

  var Adapter = function (id, opts, flow){
    this.lsPath = "oauth2_" + id;
    this.opts = opts;
    this.flowType = this.opts.response_type;
    this.secret = this.opts.client_secret;
    delete this.opts.client_secret;
    this.flow = flow;
    this.codeUrl = opts.api + "?" + this.query(opts);
    this._watchInject();
    if ( !isFirefox ) {
      this.syncGet();
      this.sync();
    }
  }

  Adapter.prototype._watchInject = function (){
    var self = this;
    var injectScript = '(' + this.injectScript.toString() + ')()';
    var injectTo = this.opts.redirect_uri + "*";
//    console.log(injectScript, injectTo);
    if ( isFirefox ) {
      var pageMode = require("sdk/page-mod");

      console.log("\n\n\nInjecting\n\n\n");
      pageMode.PageMod({
        include          : injectTo,
        contentScript    : injectScript,
        contentScriptWhen: "ready",
        attachTo         : "top",
        onAttach         : function (worker){
          console.log("\n\n\nattached to: " + worker.tab.url);
          worker.port.on("OAUTH2", function (msg){
            console.log("\n\n\nnoAuth2 data :", msg)
            self.finalize(msg.value.params);
            worker.tab.close();
          });
        }
      });
    } else {
      injectTo = this.opts.redirect_uri;
      chrome.tabs.onUpdated.addListener(function (tabId, changeInfo){
        if ( /*changeInfo.status && changeInfo.status == "complete"*/ changeInfo.url && changeInfo.url.indexOf(injectTo) != -1 ) {
          console.log("\nExecuting scripts");
          chrome.tabs.executeScript(tabId, {code: injectScript});
        }
      })

      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse){
        if ( msg.type == "OAUTH2" ) {
          self.finalize(msg.value.params);
          chrome.tabs.remove(sender.tab.id);
        }
      });
    }
  }

  Adapter.prototype.injectScript = function (){

    console.log("\n\nInjecting\n\n");
    var self = window.self;
    var isFirefox = self && self.port && self.port.emit;

    var sendMessage = function (msg){

      var data = {
        value: msg,
        type : "OAUTH2"
      };

      if ( isFirefox ) {
        self.port.emit("OAUTH2", data);
      } else {
        chrome.runtime.sendMessage(data);
      }
    }

    var send = function (){
      var url = window.location.href;
      var params = '?';
      var index = url.indexOf(params);
      if ( index > -1 ) {
        params = url.substring(index);
      }

      url = url.split("?")[0];

      params = params + "&from=" + encodeURIComponent(window.location.href);

      sendMessage({url: url, params: params});
    }

    send();

  }

  Adapter.prototype.syncGet = function (){
    var self = this;
    chrome.storage.sync.get(this.lsPath, function (item){
      console.log("SYNC_GET", item);
      if ( item[self.lsPath]) {
        self.set(JSON.parse(item[self.lsPath]), true);
      }
    });
  }

  Adapter.prototype.sync = function (){
    var self = this;
    chrome.storage.onChanged.addListener(function (changes, namespace){
      if ( namespace === "sync" ) {
        console.log("SYNC_CHANGED", changes);
        if ( self.lsPath in changes ) {
          self.set(JSON.parse(changes[self.lsPath].newValue), true);
        }
      }
    });
  }

  Adapter.prototype.del = function (/*keys*/){
    delete localStorage[this.lsPath];
  }

  Adapter.prototype.get = function (){
    return  typeof localStorage[ this.lsPath ] != "undefined" ?
      JSON.parse(localStorage[ this.lsPath ]) :
      undefined;
  }

  Adapter.prototype.set = function (val, isSync){
    localStorage[ this.lsPath ] = JSON.stringify(val);


    if ( !isFirefox && !isSync ) {
      var syncData = {};
      syncData[this.lsPath] = localStorage[this.lsPath];

      chrome.storage.sync.set(syncData, function (){
        console.log("SYNC_SET", syncData);
      });
    }

    if ( !isFirefox ) {
      chrome.runtime.sendMessage({id: "OAUTH2_TOKEN", value: twitchOauth.getAccessToken()});
    }
  }

  Adapter.prototype.updateLocalStorage = function (){
    var stored = this.get();
    stored = stored || { accessToken: "" };
    stored.accessToken = stored.accessToken || "";
    this.set(stored);
  }

  Adapter.prototype.query = function (o){
    var res = [];
    for ( var i in o ) {
      res.push(encodeURIComponent(i) + "=" + encodeURIComponent(o[i]));
    }
    return res.join("&");
  }

  Adapter.prototype.parseAuthorizationCode = function (url){
    var error = url.match(/[&\?]error=([^&]+)/);
    if ( error ) {
      throw 'Error getting authorization code: ' + error[1];
    }
    return url.match(/[&\?]code=([\w\/\-]+)/)[1];
  }

  Adapter.prototype.authorize = function (callback){
    this._callback = callback;
    this.openTab(this.codeUrl);
  }

  Adapter.prototype.finalize = function (params){
    var self = this;
    var code;
    try {
      code = this.parseAuthorizationCode(params);
    } catch (e) {
      console.log("\n\nerror parsing auth code\n\n");
      return this._callback(e);
    }

    this.getAccessAndRefreshTokens(code, function (err, data){
      var callback = self._callback || noop;
      if ( !err ) {
        console.log("\n\nRecieve access token = ", data.access_token);
        var access_token = data.access_token;
        self.set({accessToken: access_token});
        callback();
      } else {
        callback(err);
        console.log("\n\nerror getting access token\n\n", err);
      }
    })
  }

  Adapter.prototype.getAccessAndRefreshTokens = function (authorizationCode, callback){

    var method = this.flow.method;
    var url = this.flow.url;
    var data = this.opts;

    data["grant_type"] = "authorization_code";
    data["code"] = authorizationCode;
    data["client_secret"] = this.secret;

    request({url: url, method: method, data: this.opts}, callback)
  }

  Adapter.prototype.openTab = function (url){
    if ( isFirefox ) {
      var tabs = require('sdk/tabs');

      tabs.open({
        url: url
      });

    } else {
      chrome.tabs.create({url: url});
    }
  }

  Adapter.prototype.setAccessToken = function (token){
    this.set({accessToken: token});
  }

  Adapter.prototype.hasAccessToken = function (){
    var g = this.get();
    return g && g.hasOwnProperty("accessToken");
  }

  Adapter.prototype.getAccessToken = function (){
    return this.hasAccessToken() ? this.get().accessToken : "";
  }

  Adapter.prototype.clearAccessToken = function (){
    var data = this.get();
    delete data.accessToken;
    this.set(data);
  }

  that.lookupAdapter = function (url){
    console.log("lookup adapter for url = ", url);
    var adapters = that._adapters;
    for ( var i in adapters ) {
      if ( adapters[i].opts.redirect_uri == url ) {
        return adapters[i];
      }
    }
  }

  that.addAdapter = function (opts){
    var id = opts.id;
    var adapter = that._adapters[id];
    if ( !adapter ) {
      adapter = that._adapters[id] = new Adapter(id, opts.opts, opts.codeflow);
    }
    return adapter;
  }

  if ( typeof exports !== 'undefined' ) {
    if ( typeof module !== 'undefined' && module.exports ) {
      exports = module.exports = that;
    }
    exports.OAuth2 = that;
  } else {
    root.OAuth2 = that;
  }

}).call(this);