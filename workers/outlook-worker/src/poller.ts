import { OutlookComAdapter } from "./outlook-com-adapter.js";
import { HttpOutlookReplyEventSink, OutlookReplyPoller } from "./reply-poller.js";

const poller = new OutlookReplyPoller(new OutlookComAdapter(), new HttpOutlookReplyEventSink(), {
  watchDirectory: process.env.OUTLOOK_WATCH_DIRECTORY
});

await poller.runForever();
