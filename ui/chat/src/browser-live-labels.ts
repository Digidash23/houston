export interface BrowserLiveViewLabels {
  privacy: string;
  back: string;
  address: string;
  addressRefused: string;
  finish: string;
  cancel: string;
  close: string;
  connecting: string;
  reconnecting: string;
  lost: string;
  retry: string;
  endedDone: string;
  endedCancelled: string;
  endedExpired: string;
  endedNone: string;
  notOwner: string;
  tapToType: string;
  /** The page itself, for assistive tech. */
  website: string;
  timeLeft: (minutes: number) => string;
}

export const DEFAULT_BROWSER_LIVE_VIEW_LABELS: BrowserLiveViewLabels = {
  privacy:
    "What you type goes to the website. This AI Employee keeps the sign-in for later, never your password.",
  back: "Back",
  address: "Web address",
  addressRefused: "Only website addresses can be opened here.",
  finish: "I'm done",
  cancel: "Cancel",
  close: "Close",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  lost: "The connection was lost.",
  retry: "Try again",
  endedDone: "Done. You can close this.",
  endedCancelled: "You closed the browser.",
  endedExpired: "Time ran out. Ask in the chat to try again.",
  endedNone: "This browser is no longer waiting for you.",
  notOwner: "Only the person who asked can use this browser.",
  tapToType: "Tap the page to type",
  website: "Website",
  timeLeft: (minutes) => `${minutes} min left`,
};
