
# Private active-trip map

The Rider, Merchant and Driver Ride screens now share one ActiveTripMap component. This update adds stored numeric request pins and optional live GPS sharing by the assigned Driver. It does not accept trips, change fares, approve accounts, settle escrow or create new API entry files.

## Install

Save all ten supplied files in the two five-file batches, then run the supplied Customer PowerShell checks. Run the complete ACTIVE_TRIP_LOCATION_SETUP.sql in the shared Supabase SQL Editor. It adds nullable columns and private tables and preserves existing requests. Then run the separate ACTIVE_TRIP_LOCATION_READINESS.sql. All six readiness values should be true.

Unlike the passcode migration, this location SQL is additive and can be installed before deployment. Keep step 101 PASSCODE_SECURITY_SETUP.sql on hold until the coordinated passcode release. New Customer code starts sending the saved pin fields only after the location SQL is installed. Deploying the new code without the location SQL would cause new booking inserts to fail.

## What users see

New Rider and Merchant requests store the exact selected pickup and destination coordinate pairs. A saved trip's pins cannot be rewritten after creation; changing locations requires a new request through the existing cancellation workflow. Older requests keep their written addresses and have no invented pins.

After verified acceptance, the Rider or Merchant Ride screen displays the assigned driver's private map. A and B identify the saved pickup and destination. D appears only with a fresh GPS reading from that Driver. Before sharing, on read failures or when GPS is stale, the screen says so. No fixed street, fabricated driver position or guessed arrival time is displayed.

The assigned Driver goes online on the Ride screen to load the assigned trip, sees its saved pins and can choose Share live location. This explicitly starts the browser permission flow. The Driver can choose Stop sharing location at any time. Open navigation to pickup/destination is a separate explicit link to Google Maps; it does not accept the trip or make a payment. The active trip map shows pins, not turn-by-turn guidance or a continuously recalculated road route.

## GPS operation and privacy

The Driver must use an HTTPS browser and allow location permission. Browser policy, device settings or a denied permission may block GPS. Sharing works while this Ride screen remains visible. Going offline, leaving the Ride screen, locking/backgrounding the app or closing the page stops the watch. Returning does not automatically restart sharing: choose Share live location again.

This web implementation does not promise native-app background tracking. Opening external navigation may hide MATMOVE and stop its GPS sharing. Device/screen and browser behaviour must be tested on the target Android and iPhone browsers.

GPS updates are throttled to at most one upload every five seconds and must be recent and within 150 metres reported accuracy. The UI reads the current location about every five seconds while visible and avoids overlapping reads. Browser acquisition may be slower or stop providing fresh samples when the device is stationary; the screen reports unavailable/stale readings instead of claiming an update.

Only the request owner and its currently assigned Driver can read active-trip locations. Active staff and unrelated Drivers/customers cannot inspect them. Direct browser access to both tracking tables is denied. There is one latest position per trip, not a trail of stored movement history.

Each sharing start receives a private server-generated session key. Stop revokes that key; a delayed upload cannot restart the stopped session. An old screen's cleanup cannot revoke a newer sharing session. Trip completion, cancellation or reassignment removes the stored position and sharing lease. If connectivity prevents cleanup, the server stops returning the last position after 45 seconds; clients hide stale or unavailable positions. No background upload loop is installed.

GPS is supplied by the device and cannot prove a person's physical identity or prevent all location spoofing. Location data never authorizes a fare, KYC approval, payment or completion action.

## After-deployment verification

1. Create a new unfunded test request with two confirmed map pins. Verify its numeric pins are saved and match the written locations. Use the existing acceptance/payment workflow to start a permitted test trip; this map update does not bypass that workflow.
2. On the assigned Driver's visible Ride screen, choose Share live location and allow GPS. On the request owner's Rider or Merchant Ride screen, verify D updates and an update time/accuracy is shown.
3. Use a different Driver or customer account: the private location RPC must reject access. Admin staff access alone must not reveal the customer's tracking data.
4. Stop sharing, navigate away, switch apps and deny permission in separate tests. Confirm there are no further uploads and no false live marker. Reopening the Ride screen requires an explicit sharing start.
5. Complete or cancel the trip using its existing verified flow. Confirm the private position and sharing session are removed and later reads/publishes fail.

Automated tests validate SQL privacy, lease revocation, lifecycle and numeric-coordinate handling. They do not verify live GPS accuracy, provider payment settlement or your deployed Maps key.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition and https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/clearWatch
