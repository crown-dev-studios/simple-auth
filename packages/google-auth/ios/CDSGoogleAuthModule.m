#import <React/RCTBridgeModule.h>
#import <dispatch/dispatch.h>

@interface RCT_EXTERN_MODULE(CDSGoogleAuth, NSObject)
RCT_EXTERN_METHOD(configure:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(signIn:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(signOut:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface CDSGoogleAuth (MainQueue)
@end

@implementation CDSGoogleAuth (MainQueue)
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}
@end
