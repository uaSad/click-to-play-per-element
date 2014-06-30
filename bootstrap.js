/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 * The Original Code is mozilla.org code (Firefox 23)
 * The Initial Developer of the Original Code is mozilla.org.
*/

// Template based on Private Tab by Infocatcher
// https://addons.mozilla.org/firefox/addon/private-tab

// "Click To Play" based on
// "Pref for activating single plugins" patch by John Schoenick
// https://bugzilla.mozilla.org/attachment.cgi?id=782759
// https://bugzilla.mozilla.org/show_bug.cgi?id=888705

'use strict';

const WINDOW_LOADED = -1;
const WINDOW_CLOSED = -2;

const LOG_PREFIX = '[Click to Play per-element] ';
const PREF_BRANCH = 'extensions.uaSad@ClickToPlayPerElement.';
const ADDON_ROOT = 'chrome://uasadclicktoplayperelement/content/';
const PREF_FILE = ADDON_ROOT + 'defaults/preferences/prefs.js';
const STYLE_FILE_CTPPE = ADDON_ROOT + 'chrome/clickToPlayPlugin.css';
const STYLE_FILE_HPN = ADDON_ROOT + 'chrome/skin/hpn.css';

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import('resource://gre/modules/Services.jsm');
(function(global) {
	let consoleJSM = Cu.import('resource://gre/modules/devtools/Console.jsm', {});
	if (typeof console === 'undefined')
		global.console = consoleJSM.console;
})(this);

function install(params, reason) {
}
function uninstall(params, reason) {
	if (reason !== ADDON_UNINSTALL)
		return;

	let deletePrefsOnUninstall = PREF_BRANCH + 'deletePrefsOnUninstall';

	if (Services.prefs.getPrefType(deletePrefsOnUninstall) === 128 &&
			Services.prefs.getBoolPref(deletePrefsOnUninstall))
		Services.prefs.deleteBranch(PREF_BRANCH);
}
function startup(params, reason) {
	clickToPlayPE.init(reason);
}
function shutdown(params, reason) {
	clickToPlayPE.destroy(reason);
}

let clickToPlayPE = {
	initialized: false,
	appVersion: 0,
	init: function(reason) {
		if (this.initialized)
			return;
		this.initialized = true;

		this.appVersion = parseInt(Services.appinfo.platformVersion);

		prefs.init();
		_dbg = prefs.get('debug', false);

		this.checkPrefs();

		for (let window in this.windows)
			this.initWindow(window, reason);

		Services.ww.registerNotification(this);
		if (prefs.get('styles.ctppe', true))
			styleSheetLoader.loadStyles('CTPpe', STYLE_FILE_CTPPE);
	},
	destroy: function(reason) {
		if (!this.initialized)
			return;
		this.initialized = false;

		for (let window in this.windows)
			this.destroyWindow(window, reason);

		Services.ww.unregisterNotification(this);
		if (reason != APP_SHUTDOWN) {
			styleSheetLoader.unloadStyles('CTPpe', STYLE_FILE_CTPPE);
		}

		prefs.destroy();
	},

	observe: function(subject, topic, data) {
		if (topic == 'domwindowopened') {
			subject.addEventListener('load', this, false);
		}
		else if (topic == 'domwindowclosed') {
			this.destroyWindow(subject, WINDOW_CLOSED);
		}
	},

	handleEvent: function(event) {
		switch (event.type) {
			case 'load':
				this.loadHandler(event);
				break;
			case 'unload':
				this.windowClosingHandler(event);
				break;
			case 'PluginBindingAttached':
				this.pluginBindingAttached(event);
				break;
		}
	},
	loadHandler: function(event) {
		let window = event.originalTarget.defaultView;
		window.removeEventListener('load', this, false);
		this.initWindow(window, WINDOW_LOADED);
	},
	windowClosingHandler: function(event) {
		let window = event.currentTarget;
		this.destroyWindowClosingHandler(window);
	},
	destroyWindowClosingHandler: function(window) {
		let {gBrowser} = window;
		window.removeEventListener('unload', this, false);
		gBrowser.removeEventListener('PluginBindingAttached', this, true, true);

		styleSheetUtils.removeSheet(window, STYLE_FILE_HPN);
	},

	initWindow: function(window, reason) {
		if (reason == WINDOW_LOADED && !this.isTargetWindow(window)) {
			return;
		}
		let {gPluginHandler} = window;
		if (gPluginHandler &&
				'_overlayClickListener' in gPluginHandler &&
				'handleEvent' in gPluginHandler._overlayClickListener &&
				'canActivatePlugin' in gPluginHandler &&
				'_getBindingType' in gPluginHandler) {
			let {gBrowser} = window;
			window.addEventListener('unload', this, false);
			gBrowser.addEventListener('PluginBindingAttached', this, true, true);

			if (prefs.get('styles.hidePluginNotifications', false))
				styleSheetUtils.loadSheet(window, STYLE_FILE_HPN);
		}
		else {
			Cu.reportError(LOG_PREFIX + 'startup error: gPluginHandler');
		}
	},
	destroyWindow: function(window, reason) {
		window.removeEventListener('load', this, false); // Window can be closed before "load"
		if (reason == WINDOW_CLOSED && !this.isTargetWindow(window))
			return;
		if (reason != WINDOW_CLOSED) {
			// See resource:///modules/sessionstore/SessionStore.jsm
			// "domwindowclosed" => onClose() => "SSWindowClosing"
			// This may happens after our "domwindowclosed" notification!
			this.destroyWindowClosingHandler(window);
		}
	},

	get windows() {
		let ws = Services.wm.getEnumerator('navigator:browser');
		while (ws.hasMoreElements()) {
			let window = ws.getNext();
			yield window;
		}
	},
	isTargetWindow: function(window) {
		// Note: we can't touch document.documentElement in not yet loaded window
		// (to check "windowtype"), see https://github.com/Infocatcher/Private_Tab/issues/61
		let loc = window.location.href;
		return loc == 'chrome://browser/content/browser.xul';
	},

	prefChanged: function(pName, pVal) {
		switch (pName) {
			case 'styles.ctppe':
				if (pVal) {
					styleSheetLoader.loadStyles('CTPpe', STYLE_FILE_CTPPE);
				}
				else {
					styleSheetLoader.unloadStyles('CTPpe', STYLE_FILE_CTPPE);
				}
				break;
			case 'styles.hidePluginNotifications':
				if (pVal) {
					for (let window in this.windows)
						styleSheetUtils.loadSheet(window, STYLE_FILE_HPN);
				}
				else {
					for (let window in this.windows)
						styleSheetUtils.removeSheet(window, STYLE_FILE_HPN);
				}
				break;
			case 'debug':
				_dbg = pVal;
				break;
		}
	},

	checkPrefs: function() {
		let pNamesBooleans = [
			'styles.ctppe',
			'styles.hidePluginNotifications',
			'debug'
		];
		for (let i = 0, len = pNamesBooleans.length; i < len; i++) {
			let pVal = prefs.get(pNamesBooleans[i]);
			if (typeof pVal != 'boolean')
				prefs.reset(pNamesBooleans[i]);
		}
	},

	get dwu() {
		delete this.dwu;
		return this.dwu = Cc['@mozilla.org/inspector/dom-utils;1']
			.getService(Ci.inIDOMUtils);
	},
	getTopChromeWindow: function(event) {
		let eventTarget = event.currentTarget || event.originalTarget || event.target;
		let window = eventTarget.ownerDocument.defaultView.top;
		for (;;) {
			let browser = this.dwu.getParentForNode(window.document, true);
			if (!browser)
				break;
			window = browser.ownerDocument.defaultView.top;
		}
		return window;
	},

	pluginBindingAttached: function(event) {
		_dbg && console.log(LOG_PREFIX + 'CTPpe.pluginBindingAttached()');

		let window = clickToPlayPE.getTopChromeWindow(event);
		window.setTimeout(function() {
			this.pluginAttached(event, window);
		}.bind(this), 250);
	},
	pluginAttached: function(event, window) {
		_dbg && console.log(LOG_PREFIX + 'CTPpe.pluginAttached()');

		let eventType = event.type;
		if (eventType == 'PluginRemoved') {
			return;
		}
		let plugin = event.target;
		let doc = plugin.ownerDocument;
		if (!(plugin instanceof Ci.nsIObjectLoadingContent))
			return;
		if (eventType == 'PluginBindingAttached') {
			// The plugin binding fires this event when it is created.
			// As an untrusted event, ensure that this object actually has a binding
			// and make sure we don't handle it twice
			let {gPluginHandler} = window;
			let overlay = gPluginHandler.getPluginUI(plugin, 'main');
			if (!overlay) {
				return;
			}
			// Lookup the handler for this binding
			eventType = gPluginHandler._getBindingType(plugin);
			if (!eventType) {
				// Not all bindings have handlers
				return;
			}
		}
		if (eventType == 'PluginClickToPlay') {
			this._handleClickToPlayEvent(plugin, window);
		}
	},
	_handleClickToPlayEvent: function PH_handleClickToPlayEvent(aPlugin, window) {
		_dbg && console.log(LOG_PREFIX + 'CTPpe._handleClickToPlayEvent()');

		let doc = aPlugin.ownerDocument;
		let {gPluginHandler, gBrowser} = window;
		let browser = gBrowser.getBrowserForDocument(doc.defaultView.top.document);
		let objLoadingContent = aPlugin.QueryInterface(Ci.nsIObjectLoadingContent);
		// guard against giving pluginHost.getPermissionStringForType a type
		// not associated with any known plugin
		if (!gPluginHandler.isKnownPlugin(objLoadingContent))
			return;
		let overlay = gPluginHandler.getPluginUI(aPlugin, 'main');
		if (overlay) {
			overlay.addEventListener('click', clickToPlayPE._overlayClickListener, true);
			overlay.removeEventListener('click', gPluginHandler._overlayClickListener, true);
			
			let pluginRect = aPlugin.getBoundingClientRect();
			let right = pluginRect.right - 2;
			let top = pluginRect.top + 2;
			if (right <= 0 || top <= 0) {
				overlay.classList.toggle('visible', true);
			}
		}
	},
	
	_overlayClickListener: {
		handleEvent: function PH_handleOverlayClick(aEvent) {
			_dbg && console.log(LOG_PREFIX + 'CTPpe._overlayClickListener()');

			let window = clickToPlayPE.getTopChromeWindow(aEvent);
			let {gBrowser, gPluginHandler, PopupNotifications, HTMLAnchorElement} = window;
			let document = window.document;
			let plugin = document.getBindingParent(aEvent.target);
			let contentWindow = plugin.ownerDocument.defaultView.top;
			// gBrowser.getBrowserForDocument does not exist in the case where we
			// drag-and-dropped a tab from a window containing only that tab. In
			// that case, the window gets destroyed.
			let browser = gBrowser.getBrowserForDocument ?
				gBrowser.getBrowserForDocument(contentWindow.document) :
				null;
			// If browser is null here, we've been drag-and-dropped from another
			// window, and this is the wrong click handler.
			if (!browser) {
				aEvent.target.removeEventListener('click', clickToPlayPE._overlayClickListener, true);
				return;
			}
			let overlay = gPluginHandler.getPluginUI(plugin, 'main');
			if (!overlay.classList.contains('visible'))
				return;
			if (!(aEvent.originalTarget instanceof HTMLAnchorElement) &&
					(aEvent.originalTarget.getAttribute('anonid') == 'closeIcon') &&
					aEvent.button == 0 && aEvent.isTrusted) {
				if (overlay)
					overlay.style.visibility = 'hidden';
			}
			let objLoadingContent = plugin.QueryInterface(Ci.nsIObjectLoadingContent);
			// Have to check that the target is not the link to update the plugin
			if (!(aEvent.originalTarget instanceof HTMLAnchorElement) &&
					(aEvent.originalTarget.getAttribute('anonid') != 'closeIcon') &&
					aEvent.button == 0 && aEvent.isTrusted) {
				if (gPluginHandler.canActivatePlugin(objLoadingContent) &&
						objLoadingContent.pluginFallbackType !=
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_UPDATABLE &&
						objLoadingContent.pluginFallbackType !=
						Ci.nsIObjectLoadingContent.PLUGIN_VULNERABLE_NO_UPDATE) {
					objLoadingContent.playPlugin();
				}
				else {
					gPluginHandler._showClickToPlayNotification(browser, plugin);
				}
				aEvent.stopPropagation();
				aEvent.preventDefault();
			}
		}
	}
};

let styleSheetLoader = {
	SHEET_TYPE: {
	  'agent': 'AGENT_SHEET',
	  'user': 'USER_SHEET',
	  'author': 'AUTHOR_SHEET'
	},
	makeCSSURI: function(url) {
		if (!/css$/.test(url))
			url = 'data:text/css,' + encodeURIComponent(url);
		return this.ios.newURI(url, null, null);
	},
	get ios() {
		delete this.ios;
		return this.ios = Cc['@mozilla.org/network/io-service;1'].
            getService(Ci.nsIIOService);
	},
	get sss() {
		delete this.sss;
		return this.sss = Cc['@mozilla.org/content/style-sheet-service;1']
			.getService(Ci.nsIStyleSheetService);
	},
	loadStyles: function(id, url, type) {
		if (!(type && type in this.SHEET_TYPE))
			type = 'agent';
		let cssType = this.SHEET_TYPE[type];

		let cssURI;
		if (!(url instanceof Ci.nsIURI))
			cssURI = this.makeCSSURI(url);

		let sss = this.sss;
		if (!this.sss.sheetRegistered(cssURI, sss[cssType])) {
			sss.loadAndRegisterSheet(cssURI, sss[cssType]);
			this.ssAdd(id, url, type);
		}
	},
	unloadStyles: function(id, url, type) {
		if (!(type && type in this.SHEET_TYPE))
			type = 'agent';
		let cssType = this.SHEET_TYPE[type];

		let cssURI;
		if (!(url instanceof Ci.nsIURI))
			cssURI = this.makeCSSURI(url);

		let sss = this.sss;
		if (sss.sheetRegistered(cssURI, sss[cssType])) {
			sss.unregisterSheet(cssURI, sss[cssType]);
			this.ssDel(id, url, type);
		}
	},
	reloadStyles: function(id, url, type) {
		if (!(type && type in this.SHEET_TYPE))
			type = 'agent';
		if (this.ssHas(id, type))
			this.unloadStyles(id, this.ssMap[id].url, type);
		this.loadStyles(id, url, type);
	},
	ssMap: {},
	ssAdd: function(id, url, type) {
		if (!(id in this.ssMap)) {
			this.ssMap[id] = {
				url: url,
				type: type
			};
		}
	},
	ssDel: function(id, url, type) {
		if (id in this.ssMap) {
			delete this.ssMap[id];
		}
	},
	ssHas: function(id, type) {
		if (id in this.ssMap &&
				this.ssMap[id].type === type)
			return true;
		return false;
	}
};

let styleSheetUtils = {
	SHEET_TYPE: {
	  'agent': 'AGENT_SHEET',
	  'user': 'USER_SHEET',
	  'author': 'AUTHOR_SHEET'
	},
	isTypeValid: function(type) {
		return type in this.SHEET_TYPE;
	},
	makeCSSURI: function(url) {
		if (!/css$/.test(url))
			url = 'data:text/css,' + encodeURIComponent(url);
		return this.ios.newURI(url, null, null);
	},
	get ios() {
		delete this.ios;
		return this.ios = Cc['@mozilla.org/network/io-service;1'].
            getService(Ci.nsIIOService);
	},
	getDOMWindowUtils: function(window) {
		return window.QueryInterface(Ci.nsIInterfaceRequestor).
					getInterface(Ci.nsIDOMWindowUtils);
	},
	loadSheet: function(window, url, type) {
		if (!(type && type in this.SHEET_TYPE))
			type = 'author';
		type = this.SHEET_TYPE[type];

		if (!(url instanceof Ci.nsIURI))
			url = this.makeCSSURI(url);

		let winUtils = this.getDOMWindowUtils(window);
		try {
			winUtils.loadSheet(url, winUtils[type]);
		}
		catch (e) {};
	},
	removeSheet: function(window, url, type) {
		if (!(type && type in this.SHEET_TYPE))
			type = 'author';
		type = this.SHEET_TYPE[type];

		if (!(url instanceof Ci.nsIURI))
			url = this.makeCSSURI(url);

		let winUtils = this.getDOMWindowUtils(window);
		try {
			winUtils.removeSheet(url, winUtils[type]);
		}
		catch (e) {};
	}
};

let prefs = {
	ns: PREF_BRANCH,
	version: 1,
	initialized: false,
	init: function() {
		if (this.initialized)
			return;
		this.initialized = true;

		let curVersion = this.getPref(this.ns + 'prefsVersion', 0);
		if (curVersion < this.version) {
			this.migratePrefs(curVersion);
			this.setPref(this.ns + 'prefsVersion', this.version);
		}

		//~ todo: add condition when https://bugzilla.mozilla.org/show_bug.cgi?id=564675 will be fixed
		this.loadDefaultPrefs();
		Services.prefs.addObserver(this.ns, this, false);
	},
	destroy: function() {
		if (!this.initialized)
			return;
		this.initialized = false;

		Services.prefs.removeObserver(this.ns, this);
	},
	migratePrefs: function(version) {
		let boolean = function(pName) { // true -> 1
			if (this.getPref(pName) === true) {
				Services.prefs.deleteBranch(pName);
				this.setPref(pName, 1);
			}
		}.bind(this);
	},
	observe: function(subject, topic, pName) {
		if (topic != 'nsPref:changed')
			return;
		let shortName = pName.substr(this.ns.length);
		let val = this.getPref(pName);
		this._cache[shortName] = val;
		clickToPlayPE.prefChanged(shortName, val);
	},

	loadDefaultPrefs: function() {
		_dbg && console.log(LOG_PREFIX + 'prefs.loadDefaultPrefs()');

		let defaultBranch = Services.prefs.getDefaultBranch('');
		let prefsFile = PREF_FILE;
		let prefs = this;
		let scope = {
			pref: function(pName, val) {
				let pType = defaultBranch.getPrefType(pName);
				if (pType != defaultBranch.PREF_INVALID && pType != prefs.getValueType(val)) {
					Cu.reportError(
						LOG_PREFIX + 'Changed preference type for "' + pName
						+ '", old value will be lost!'
					);
					defaultBranch.deleteBranch(pName);
				}
				prefs.setPref(pName, val, defaultBranch);
			}
		};
		Services.scriptloader.loadSubScript(prefsFile, scope);
	},

	// Using __proto__ or setPrototypeOf to set a prototype is now deprecated.
	// https://bugzilla.mozilla.org/show_bug.cgi?id=948227
	_cache: Object.create(null),
	get: function(pName, defaultVal) {
		let cache = this._cache;
		return pName in cache
			? cache[pName]
			: (cache[pName] = this.getPref(this.ns + pName, defaultVal));
	},
	set: function(pName, val) {
		return this.setPref(this.ns + pName, val);
	},
	getPref: function(pName, defaultVal, prefBranch) {
		let ps = prefBranch || Services.prefs;
		switch (ps.getPrefType(pName)) {
			case ps.PREF_BOOL:
				return ps.getBoolPref(pName);
			case ps.PREF_INT:
				return ps.getIntPref(pName);
			case ps.PREF_STRING:
				return ps.getComplexValue(pName, Ci.nsISupportsString).data;
		}
		return defaultVal;
	},
	setPref: function(pName, val, prefBranch) {
		let ps = prefBranch || Services.prefs;
		let pType = ps.getPrefType(pName);
		if (pType == ps.PREF_INVALID)
			pType = this.getValueType(val);
		switch (pType) {
			case ps.PREF_BOOL:
				ps.setBoolPref(pName, val);
				break;
			case ps.PREF_INT:
				ps.setIntPref(pName, val);
				break;
			case ps.PREF_STRING:
				let ss = Ci.nsISupportsString;
				let str = Cc['@mozilla.org/supports-string;1']
					.createInstance(ss);
				str.data = val;
				ps.setComplexValue(pName, ss, str);
		}
		return this;
	},
	getValueType: function(val) {
		switch (typeof val) {
			case 'boolean':
				return Services.prefs.PREF_BOOL;
			case 'number':
				return Services.prefs.PREF_INT;
		}
		return Services.prefs.PREF_STRING;

	},
	has: function(pName) {
		return this._has(pName);
	},
	_has: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		return (ps.getPrefType(pName) != Ci.nsIPrefBranch.PREF_INVALID);
	},
	reset: function(pName) {
		if (this.has(pName))
			this._reset(pName);
	},
	_reset: function(pName) {
		let ps = Services.prefs;
		pName = this.ns + pName;
		try {
			ps.clearUserPref(pName);
		}
		catch (ex) {
			// The pref service throws NS_ERROR_UNEXPECTED when the caller tries
			// to reset a pref that doesn't exist or is already set to its default
			// value.  This interface fails silently in those cases, so callers
			// can unconditionally reset a pref without having to check if it needs
			// resetting first or trap exceptions after the fact.  It passes through
			// other exceptions, however, so callers know about them, since we don't
			// know what other exceptions might be thrown and what they might mean.
			if (ex.result != Cr.NS_ERROR_UNEXPECTED)
				throw ex;
		}
	}
};

// Be careful, loggers always works until prefs aren't initialized
// (and if "debug" preference has default value)
let _dbg = true;
