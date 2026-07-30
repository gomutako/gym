#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(RestTimerPlugin, "RestTimer",
    CAP_PLUGIN_METHOD(requestPermission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(schedule, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(cancel, CAPPluginReturnPromise);
)
