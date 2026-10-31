
# Route previews and optional voice location entry

This Customer update changes the shared RideLocationPicker used by the Rider and Merchant booking screens. It adds automatic route previews and optional browser speech entry. It creates no bookings or payments and needs no Supabase migration or new API endpoint.

## Install and check

Save the five supplied files in their listed Customer project destinations. Run the accompanying PowerShell typecheck, build and sequential test block. Local changes appear on the website only after deployment. Keep PASSCODE_SECURITY_SETUP.sql (step 101) on hold for the coordinated passcode release.

## Automatic route preview

Choose both pickup and destination from matching Places results, Find results, owned saved coordinates, live GPS or map pins. Once both coordinate pairs are confirmed, the picker schedules one preview after 400 milliseconds. Typing an unconfirmed address does not request a route. Starting to edit either location immediately clears the previous route distance and calculated offer. The existing Rider and Merchant screens receive the confirmed route distance through their existing onChange callback.

Preview route remains available for an explicit retry. A manual preview cancels a queued automatic preview. Delayed results for edited or unmounted locations are ignored. Failure or timeout leaves the distance unavailable; the app does not invent a route. Users must still review the locations and fare and explicitly request the trip. Existing fare negotiation, escrow and payment checks remain separate.

## Optional microphone entry

The interface checks for SpeechRecognition or webkitSpeechRecognition support, but does not request microphone access during page load. The user chooses Speak pickup or Speak destination to begin. The screen explains that the browser may send audio to its recognition service. MATMOVE does not record or upload audio itself.

Speech uses a single final English result, limited to 3–300 characters. Recognition inserts text into the chosen field and runs the existing Places suggestion flow. The user must choose a matching place to confirm coordinates. Speech alone never creates a confirmed location, trip, fare agreement or payment.

Starting voice editing clears the old location and route first. Stop microphone, typing, choosing a location, switching voice targets, closing/backgrounding the page and the 20-second timeout stop listening and discard late results. Permission errors, unavailable recognition, silence and network errors display guidance to use typing, Find, live location or a map pin. Browser speech may require an internet connection and may not recognize every Sierra Leone street or accent accurately.

## Google Maps configuration

The update preserves the existing VITE_GOOGLE_MAPS_API_KEY and current DirectionsService integration. Voice recognition is a browser capability and does not come from that Maps key. Do not put service credentials in VITE variables.

For the existing Google Cloud project, verify that Maps JavaScript API, Places API (New) for the current suggestion flow, billing and the currently used Directions API (Legacy) are available. Restrict the browser key to the intended website referrers and required APIs. Automatic route calls use the existing Maps billing; this update does not promise free or unlimited routes.

Google identifies DirectionsService as deprecated, with existing projects supported for now. Its October 2026 guidance says new Cloud projects cannot newly enable Directions API (Legacy). This batch preserves MatMove's existing integration to avoid an unplanned routing API migration. A new Google Cloud project may require a separate migration to the Routes library. Do not silently switch keys/projects and assume the old Directions service is enabled.

## Production smoke test after deployment

1. On a Rider account, select two real nearby Freetown places. Confirm that the map route and distance appear without pressing Preview route. Inspect both pins and the fare before any trip request.
2. Repeat on a Merchant account. Edit one address while its route is loading and confirm the old distance is cleared.
3. On a supported HTTPS browser, click Speak destination, permit the microphone and say a landmark. Verify the recognized text, select the correct suggestion and inspect the resulting pin. Cancel a second listening attempt and confirm it cannot overwrite typed text.
4. Test denied microphone access and a browser without recognition. Typed search, Find, GPS and map pins must remain usable.
5. Switch apps or hide the page while listening. Confirm the microphone stops. The separate passcode privacy gate may also lock the app; that is expected background behavior.

Local mocks test lifecycle and coordinate handling, not your live Google Cloud configuration, actual road coverage, device microphone permissions or speech accuracy. Driver live GPS sharing is a separate remaining update; this batch does not claim to implement it.

## Reference documentation

- Google Directions service: https://developers.google.com/maps/documentation/javascript/legacy/directions
- Google DirectionsService reference: https://developers.google.com/maps/documentation/javascript/reference/directions
- Browser SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
