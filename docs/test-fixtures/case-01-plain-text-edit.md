# Plain Text Paragraph Edit

This fixture exercises the simplest possible sync case: a single new
paragraph of prose with no special markdown constructs.

Dorv's GDoc-to-GitHub sync should treat this as a straightforward
one-block content diff, with no structural elements to reconcile.
