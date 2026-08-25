#import <React/RCTBridgeModule.h>

// Registers the Swift VPNTunnelModule (VPNTunnelModule.swift) with the RN
// bridge by name -- resolved via the Objective-C runtime at call time, so no
// compile-time link to the Swift class (and no bridging header) is needed
// here. See https://reactnative.dev/docs/native-modules-ios#exporting-swift.
@interface RCT_EXTERN_MODULE(VPNTunnelModule, NSObject)

RCT_EXTERN_METHOD(connect:(NSDictionary *)config
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(disconnect:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLastError:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getRuntimeConfiguration:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
