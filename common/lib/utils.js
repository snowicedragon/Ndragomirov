(function (){
  var root = this
    , CHROME = "chrome"
    , FIREFOX = "firefox"
    ;

  var that = {};

  var detectBrowser = function (){
    if ( typeof window.chrome == "undefined" ) {
      return FIREFOX;
    }
    return CHROME;
  }

  var browser = that.browser = detectBrowser();

  var detectBackground = function (){
    if ( browser == CHROME ) {
      return chrome.extension.getBackgroundPage() === this;
    }
    if ( browser == FIREFOX ) {
      return typeof window == "undefined";
    }
  }

  var background = that.background = detectBackground();

  var _tabs = that.tabs = {};

  _tabs.create = function (opts){
    if ( browser == CHROME ) {
      chrome.tabs.create({url: opts.url});
    }
    if ( browser == FIREFOX ) {
      self.port.emit("twitchnow", {command: "tabs.create", value: opts});
    }
  }

  var _windows = that.windows = {};

  _windows.create = function (opts){
    if ( browser == CHROME ) {
      chrome.windows.create({url: opts.url, type: "popup", focused: true });
    }
    if ( browser == FIREFOX ) {
      self.port.emit("twitchnow", {command: "windows.create", value: {url: opts.url}});
    }
  }

  var _browserAction = that.browserAction = {};

  _browserAction.setBadgeText = function (opts){
    if ( browser == CHROME ) {
      chrome.browserAction.setBadgeText({
        text: opts.text
      })
    }
    if ( browser == FIREFOX ) {
//      throw new Error("Not Implemented");
    }
  }

  var _i18n = that.i18n = {};

  _i18n.getMessage = function (id){
    if ( browser == CHROME ) {
      return chrome.i18n.getMessage(id);
    }
    if ( browser == FIREFOX ) {
      if ( self.options.messages[id] ) {
        return self.options.messages[id].message;
      }
      if ( self.options.defaultMessages[id] ) {
        return self.options.defaultMessages[id].message;
      }
    }
  }

  var _runtime = that.runtime = {};

  _runtime.getURL = function (str){
    if ( browser == CHROME ) {
      return chrome.runtime.getURL(str);
    }
    if ( browser == FIREFOX ) {
      return self.options.dataURL + str;
    }
  }

  var notifications = that.notifications = {};

  notifications.create = function (opts){
    if ( browser == FIREFOX ) {
      self.port.emit("twitchnow", {command: "notifications.create", value: opts});
    }
  }

  notifications.richNotificationsSupported = function (){
    if ( browser == CHROME ) {
      return chrome.notifications && chrome.notifications.create;
    }
  }

  notifications.growlNotificationsSupported = function (){
    return browser == FIREFOX;
  }

  notifications.htmlNotificationsSupported = function (){
    if ( browser == CHROME ) {
      return window.webkitNotifications && window.webkitNotifications.createHTMLNotification;
    }
  }

  that._getBackgroundPage = function (){
    if ( browser == CHROME ) {
      return chrome.extension.getBackgroundPage();
    } else {
      return root;
    }
  }

  root.utils = that;

}).call(this);