/**
 * @fileoverview
 * @author Taketshi Aono
 */
'use strict';

var addSingletonGetter = require('node-singleton-getter');
var MultiMap = require('collections/multi-map');
var EventEmitter = require('eventemitter2').EventEmitter2;
var Promise = require('node-promise');
var domain = require('domain');

var _exit = process.exit;
var nullFunction = function() {};
var exit = function(code) {
      _exit.call(process, code);
      exit = nullFunction;
    };


/**
 * @constructor
 * @param {string} target
 */
function Event(target) {
  this._target = target;
  this._defaultPrevented = false;
}


Object.defineProperties(Event.prototype, {
  target : {
    get : function() {
      return this._target;
    },
    configurable : true,
    enumerable : true
  },

  defaultPrevented : {
    get : function() {
      return this._defaultPrevented;
    },
    configurable : true,
    enumerable : true
  }
});


Event.prototype.preventDefault = function() {
  this._defaultPrevented = true;
};


/**
 * @param {string} name
 * @param {Object} context
 * @returns {Function}
 */
function getProcessTerminationHandler(name, context) {
  return function processTerminationHandler(code) {
    this._firedMap[name] = true;
    this._events.emit(name, name);
    Promise.all(this._promises.get(name).concat(this._promises.get('any')))
      .then(function(e) {
        if (!e.defaultPrevented) {
          exit(code || 0);
        }
      }, function(err, e) {
        if (!e.defaultPrevented) {
          if (err instanceof Error || (err.message && err.stack)) {
            console.error('%s%s', err.message, err.stack);
          } else {
            console.error(err);
          }
          exit(code || 1);
        }
      });
  }.bind(context);
}


/**
 * @param {string} stack
 * @throws {Error}
 */
function timeoutHandler(stack) {
  console.log('The shutdown handler takes up too much time.\nCREATION STACK :\n' + stack + '\nCURRENT_STACK:\n' + new Error().stack);
  exit(1);
};


/**
 * Manage node halting process.
 * @constructor
 */
function ProcessSentinel() {
  this._events = new EventEmitter({delimiter : '::', wildcard : true});
  this._promises = new MultiMap();
  this._domain = domain.create();
  this._firedMap = {};

  //normal
  process.exit = getProcessTerminationHandler('process::exit', this);

  //SIGINT
  process.on('SIGINT', getProcessTerminationHandler('process::interrupted', this));

  //SIGABRT
  process.on('SIGABRT', getProcessTerminationHandler('process::abort', this));

  //SIGTERM
  process.on('SIGTERM', getProcessTerminationHandler('process::terminate', this));

  //SIGQUIT
  process.on('SIGQUIT', getProcessTerminationHandler('process::sigquit', this));

  //SIGQUIT
  process.on('SIGHUP', getProcessTerminationHandler('process::sighup', this));

  //uncaughtException
  this._domain.on('error', getProcessTerminationHandler('domain::error', this));

  this._timeout = 3000;
}
addSingletonGetter(ProcessSentinel);


Object.defineProperties(ProcessSentinel.prototype, {
  timeout : {
    /**
     * @param {number} time
     */
    set : function(time) {
      this._timeout = time;
    },

    /**
     * @returns {number}
     */
    get : function() {
      return this._timeout;
    },
    configurable : false,
    enumerable : true
  },

  halting : {
    get : function() {
      return Object.keys(this._firedMap).length > 0;
    }
  },

  domain : {
    get : function() {
      return this._domain;
    }
  }
});


/**
 * @param {string} name
 * @param {Function} fn
 * @param {*} opt_context
 */
ProcessSentinel.prototype.observe = function(name, fn, opt_context) {
  if (this._firedMap[name]) {
    return fn.call(opt_context);
  }
  this._addEventHandler(name, fn, opt_context);
};


/**
 * @param {Function} fn
 * @param {*} opt_context
 */
ProcessSentinel.prototype.observeAny = function(fn, opt_context) {
  if (Object.keys(this._firedMap).length > 0) {
    return fn.call(opt_context);
  }
  this._addEventHandler('any', fn, opt_context);
};


/**
 * @param {string} name
 * @param {Function} fn
 */
ProcessSentinel.prototype.unobserve = function(name, fn) {
  this._promises.set(name, []);
  this._events.off(name, fn);
};


/**
 * @param {Function} fn
 */
ProcessSentinel.prototype.unobserveAny = function(fn) {
  this._promises.set('any', []);
  this._events.offAny(fn);
};


/**
 * @param {string} name
 * @param {boolean=} opt_preventDefault
 * @returns {Promise.Promise}
 */
ProcessSentinel.prototype.emit = function(name, opt_preventDefault) {
  if (name === 'any') {
    this._events.emitAny(name, opt_preventDefault);
  } else {
    this._events.emit(name, opt_preventDefault);
  }
  return Promise.all(this._promises.get(name).concat(this._promises.get('any')));
};


/**
 * @private
 * @param {string} name
 * @param {Function} fn
 * @param {*} opt_context
 */
ProcessSentinel.prototype._addEventHandler = function(name, fn, opt_context) {
  var defer = Promise.defer();
  var promise = defer.promise;
  var stack = new Error().stack;
  var fired = false;
  this._promises.get(name).push(promise);
  var handler = function(name, opt_preventDefault) {
        defer.timeout(this._timeout).then(null, timeoutHandler.bind(null, stack));
        if (!fired) {
          fired = true;
          var event = new Event(name);
          if (opt_preventDefault) {
            event.preventDefault();
          }
          fn.call(opt_context, event, function(err) {
            if (err) {
              defer.reject(err, event);
            } else {
              defer.resolve(event);
            }
          });
        }
      }.bind(this);
  if (name === 'any') {
    this._events.onAny(handler);
  } else {
    this._events.on(name, handler);
  }
};


module.exports = ProcessSentinel;