# Hint no longer assumes its child survived serialisation

One invoice bricked an entire account this afternoon — `/dashboard`, `/jobs`,
every job tab, permanently, through reloads, with no way back from the UI.
`TypeError: Cannot read properties of undefined (reading 'aria-describedby')`.

The invoice was a red herring. `Hint` cloned its child to attach
`aria-describedby`, reading `children.props`. That is safe from a client
component and unsafe from a SERVER one: `react-server-dom-webpack` defers any
element it reaches once a Flight row has written 3200 bytes, replacing it with
a `$L` reference the client rehydrates as `{ $$typeof: REACT_LAZY_TYPE,
_payload, _init }` — an object with no `.props`. `MetricBar` was the only
`<Hint>` call site in a Server Component, and it renders in the `(app)` layout,
so the throw took every authenticated page with it.

It is a BYTE COUNT, not a data problem. Sweeping row sizes against Next's own
compiled Flight server, 58 of 326 lands in a window where this fires — roughly
one in five. An account could be dead at sign-up having created nothing. The
invoice merely changed `$105,000.00` to `$96,000.00` and moved the row.

`isValidElement` guards the clone. The lazy case loses only that instance's
`aria-describedby`; the tooltip still renders and the page still works. Making
a server-component caller a client component is the better fix at the call
site — this is the guard that makes the class survivable everywhere.
