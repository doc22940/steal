/*
*********************************************************************************************

  System Loader Implementation

    - Implemented to https://github.com/jorendorff/js-loaders/blob/master/browser-loader.js

*********************************************************************************************
*/

(function() {
  var isWindows = typeof process != 'undefined' && !!process.platform.match(/^win/);
  var Promise = __global.Promise || require('when/es6-shim/Promise');

  // Helpers
  // Absolute URL parsing, from https://gist.github.com/Yaffle/1088850
  function parseURI(url) {
    var m = String(url).replace(/^\s+|\s+$/g, '').match(/^([^:\/?#]+:)?(\/\/(?:[^:@\/?#]*(?::[^:@\/?#]*)?@)?(([^:\/?#]*)(?::(\d*))?))?([^?#]*)(\?[^#]*)?(#[\s\S]*)?/);
    // authority = '//' + user + ':' + pass '@' + hostname + ':' port
    return (m ? {
      href     : m[0] || '',
      protocol : m[1] || '',
      authority: m[2] || '',
      host     : m[3] || '',
      hostname : m[4] || '',
      port     : m[5] || '',
      pathname : m[6] || '',
      search   : m[7] || '',
      hash     : m[8] || ''
    } : null);
  }
  function removeDotSegments(input) {
    var output = [];
    input.replace(/^(\.\.?(\/|$))+/, '')
      .replace(/\/(\.(\/|$))+/g, '/')
      .replace(/\/\.\.$/, '/../')
      .replace(/\/?[^\/]*/g, function (p) {
        if (p === '/..')
          output.pop();
        else
          output.push(p);
    });
    return output.join('').replace(/^\//, input.charAt(0) === '/' ? '/' : '');
  }
  var doubleSlash = /^\/\//;
  function toAbsoluteURL(inBase, inHref) {
    var href = inHref;
    var base = inBase

	if(doubleSlash.test(inHref)) {
		// Default to http
		return 'http:' + inHref;
	}

    if (isWindows)
      href = href.replace(/\\/g, '/');

    href = parseURI(href || '');
    base = parseURI(base || '');

    return !href || !base ? null : (href.protocol || base.protocol) +
      (href.protocol || href.authority ? href.authority : base.authority) +
      removeDotSegments(href.protocol || href.authority || href.pathname.charAt(0) === '/' ? href.pathname : (href.pathname ? ((base.authority && !base.pathname ? '/' : '') + base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1) + href.pathname) : base.pathname)) +
      (href.protocol || href.authority || href.pathname ? href.search : (href.search || base.search)) +
      href.hash;
  }

  var fetchTextFromURL;
  if (typeof XMLHttpRequest != 'undefined') {
    fetchTextFromURL = function(url, fulfill, reject) {
      var xhr = new XMLHttpRequest();
      var sameDomain = true;
      var doTimeout = false;
      if (!('withCredentials' in xhr)) {
        // check if same domain
        var domainCheck = /^(\w+:)?\/\/([^\/]+)/.exec(url);
        if (domainCheck) {
          sameDomain = domainCheck[2] === window.location.host;
          if (domainCheck[1])
            sameDomain &= domainCheck[1] === window.location.protocol;
        }
      }
      if (!sameDomain && typeof XDomainRequest != 'undefined') {
        xhr = new XDomainRequest();
        xhr.onload = load;
        xhr.onerror = error;
        xhr.ontimeout = error;
        xhr.onprogress = function() {};
        xhr.timeout = 0;
        doTimeout = true;
      }
      function load() {
        fulfill(xhr.responseText);
      }
      function error() {
		var s = xhr.status;
        var msg = s + ' ' + xhr.statusText + ': ' + url + '\n' || 'XHR error';
        var err = new Error(msg);
		err.url = url;
        err.statusCode = s;
        reject(err);
      }

      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          if (xhr.status === 200 || (xhr.status == 0 && xhr.responseText)) {
            load();
          } else {
            error();
          }
        }
      };
      xhr.open("GET", url, true);

      if (doTimeout)
        setTimeout(function() {
          xhr.send();
        }, 0);

      xhr.send(null);
    }
  }
  else if (typeof require != 'undefined') {
    var fs, http, https, fourOhFourFS = /ENOENT/;
    fetchTextFromURL = function(rawUrl, fulfill, reject) {
      if (rawUrl.substr(0, 5) === 'file:') {
		  fs = fs || require('fs');
		  var url = rawUrl.substr(5);
		  if (isWindows)
			url = url.replace(/\//g, '\\');
		  return fs.readFile(url, function(err, data) {
			if (err) {
			  // Mark this error as a 404, so that the npm extension
			  // will know to retry.
			  if(fourOhFourFS.test(err.message)) {
				err.statusCode = 404;
			  err.url = rawUrl;
			  }

			  return reject(err);
			} else {
			  fulfill(data + '');
			}
		  });
	  } else if(rawUrl.substr(0, 4) === 'http') {
		  var h;
		  if(rawUrl.substr(0, 6) === 'https:') {
			  h = https = https || require('https');
		  } else {
			  h = http = http || require('http');
		  }
		  return h.get(rawUrl, function(res) {
			  if(res.statusCode !== 200) {
				  reject(new Error('Request failed. Status: ' + res.statusCode));
			  } else {
				  var rawData = "";
				  res.setEncoding("utf8");
				  res.on("data", function(chunk) {
					  rawData += chunk;
				  });
				  res.on("end", function(){
					  fulfill(rawData);
				  });
			  }
		  })
	  }
    }
  }
  else if(typeof fetch === 'function') {
    fetchTextFromURL = function(url, fulfill, reject) {
      fetch(url).then(function(resp){
        return resp.text();
      }).then(function(text){
        fulfill(text);
      }).then(null, function(err){
        reject(err);
      });
    }
  }
  else {
    throw new TypeError('No environment fetch API available.');
  }

  function transformError(err, load, loader) {
	  if(typeof loader.getDependants === "undefined") {
		  return Promise.resolve();
	  }
	  var dependants = loader.getDependants(load.name);
	  if(Array.isArray(dependants) && dependants.length) {
		  var StackTrace = loader.StackTrace;
		  var isProd = loader.isEnv("production");

		  return Promise.resolve()
		  .then(function(){
			  return isProd ? Promise.resolve() : loader["import"]("@@babel-code-frame");
		  })
		  .then(function(codeFrame){
			  var parentLoad = loader.getModuleLoad(dependants[0]);
			  var pos = loader.getImportSpecifier(load.name, parentLoad) || {
				  line: 1, column: 0
			  };

			  var detail = "The module [" + loader.prettyName(load) + "] couldn't be fetched.\n" +
				"Clicking the link in the stack trace below takes you to the import.\n" +
				"See https://stealjs.com/docs/StealJS.error-messages.html#404-not-found for more information.\n";
			  var msg = err.message + "\n" + detail;

			  if(!isProd) {
				  var src = parentLoad.metadata.originalSource || parentLoad.source;
				  var codeSample = codeFrame(src, pos.line, pos.column);
				  msg += "\n" + codeSample + "\n";
			  }

			  err.message = msg;

			  var stackTrace = new StackTrace(msg, [
				  StackTrace.item(null, parentLoad.address, pos.line, pos.column)
			  ]);

			  err.stack = stackTrace.toString();
		  })
	  }
	  return Promise.resolve();
  }

  class SystemLoader extends __global.LoaderPolyfill {

    constructor(options) {
      super(options || {});

      // Set default baseURL and paths
      if (typeof location != 'undefined' && location.href) {
        var href = __global.location.href.split('#')[0].split('?')[0];
        this.baseURL = href.substring(0, href.lastIndexOf('/') + 1);
      }
      else if (typeof process != 'undefined' && process.cwd) {
        this.baseURL = 'file:' + process.cwd() + '/';
        if (isWindows)
          this.baseURL = this.baseURL.replace(/\\/g, '/');
      }
      else {
        throw new TypeError('No environment baseURL');
      }
      this.paths = { '*': '*.js' };
    }

    get global() {
      return isBrowser ? window : (isWorker ? self : __global);
    }

    get strict() { return true; }

    normalize(name, parentName, parentAddress) {
      if (typeof name != 'string')
        throw new TypeError('Module name must be a string');

      var segments = name.split('/');

      if (segments.length == 0)
        throw new TypeError('No module name provided');

      // current segment
      var i = 0;
      // is the module name relative
      var rel = false;
      // number of backtracking segments
      var dotdots = 0;
      if (segments[0] == '.') {
        i++;
        if (i == segments.length)
          throw new TypeError('Illegal module name "' + name + '"');
        rel = true;
      }
      else {
        while (segments[i] == '..') {
          i++;
          if (i == segments.length)
            throw new TypeError('Illegal module name "' + name + '"');
        }
        if (i)
          rel = true;
        dotdots = i;
      }

      /*for (var j = i; j < segments.length; j++) {
        var segment = segments[j];
        if (segment == '' || segment == '.' || segment == '..')
          throw new TypeError('Illegal module name "' + name + '"');
      }*/

      if (!rel)
        return name;

      // build the full module name
      var normalizedParts = [];
      var parentParts = (parentName || '').split('/');
      var normalizedLen = parentParts.length - 1 - dotdots;

      normalizedParts = normalizedParts.concat(parentParts.splice(0, parentParts.length - 1 - dotdots));
      normalizedParts = normalizedParts.concat(segments.splice(i, segments.length - i));

      return normalizedParts.join('/');
    }

    locate(load) {
      var name = load.name;

      // NB no specification provided for System.paths, used ideas discussed in https://github.com/jorendorff/js-loaders/issues/25

      // most specific (longest) match wins
      var pathMatch = '', wildcard;

      // check to see if we have a paths entry
      for (var p in this.paths) {
        var pathParts = p.split('*');
        if (pathParts.length > 2)
          throw new TypeError('Only one wildcard in a path is permitted');

        // exact path match
        if (pathParts.length == 1) {
          if (name == p && p.length > pathMatch.length) {
            pathMatch = p;
            break;
          }
        }

        // wildcard path match
        else {
          if (name.substr(0, pathParts[0].length) == pathParts[0] && name.substr(name.length - pathParts[1].length) == pathParts[1]) {
            pathMatch = p;
            wildcard = name.substr(pathParts[0].length, name.length - pathParts[1].length - pathParts[0].length);
          }
        }
      }

      var outPath = this.paths[pathMatch];
      if (wildcard)
        outPath = outPath.replace('*', wildcard);

      // percent encode just '#' in module names
      // according to https://github.com/jorendorff/js-loaders/blob/master/browser-loader.js#L238
      // we should encode everything, but it breaks for servers that don't expect it
      // like in (https://github.com/systemjs/systemjs/issues/168)
      if (isBrowser)
        outPath = outPath.replace(/#/g, '%23');

      return toAbsoluteURL(this.baseURL, outPath);
    }

    fetch(load) {
      var self = this;
      return new Promise(function(resolve, reject) {
        function onError(err) {
			var r = reject.bind(null, err);
			transformError(err, load, self)
			.then(r, r);
		}

        fetchTextFromURL(toAbsoluteURL(self.baseURL, load.address), function(source) {
          resolve(source);
	  }, onError);
      });
    }

  }

  var System = new SystemLoader();

  // note we have to export before runing "init" below
  if (typeof exports === 'object')
    module.exports = System;

  __global.System = System;
})();
