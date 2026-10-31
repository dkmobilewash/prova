### Count and Count like this work with no scale, on any sheet

A count is a number of things, so no scale changes it. Count, Count like this, Find on all sheets and both saves now work on electrical, mechanical, plumbing and fire protection sheets with no scale set. Line and Area still need one.

The check for the trap: `calibrationId` is null only for a COUNT, and the database refuses anything else. Saving a count never applies a scale to a sheet.
