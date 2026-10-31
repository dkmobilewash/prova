### A phone screen test can no longer fail CI with every test passing (Diego)
`diego/ticket-test-unmount`

`ci` failed on #902 with 94 of 94 phone tests passing and one error, a timer that
fired after the test file had shut down. Eight screen tests left their screen
mounted, one of them mine from the per diem work, so a list's timer could outlive
the file. It was a race, and it passed six runs in a row locally.

The shared `mount` helper now unmounts whatever a test left behind, in one place.
It also fails a test that mounts around the helper. Removing the cleanup turns
eight tests red, so the leak is now a plain failure rather than a random one.
