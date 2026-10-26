-- Itinerary composed in the rich-text editor, offered as the alternative to
-- pasting a PNR or a cruise reservation. Sanitised on the server before
-- storage and, like the raw text beside it, never parsed.
--
-- The email-override and reservation-text columns are not here: they arrive in
-- 20261025000000_booking_email_overrides_and_cruise_text.
ALTER TABLE `FlightDetail` ADD COLUMN `itineraryHtml` TEXT NULL;
ALTER TABLE `CruiseDetail` ADD COLUMN `itineraryHtml` TEXT NULL;
