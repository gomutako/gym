#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WatchLinkPlugin, "WatchLink",
    CAP_PLUGIN_METHOD(isSupported, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getLink, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getState, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(send, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setContext, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setSessionState, CAPPluginReturnPromise);
)
