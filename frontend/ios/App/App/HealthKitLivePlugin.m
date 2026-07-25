#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HealthKitLivePlugin, "HealthKitLive",
    CAP_PLUGIN_METHOD(requestAuth, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(summary, CAPPluginReturnPromise);
)
