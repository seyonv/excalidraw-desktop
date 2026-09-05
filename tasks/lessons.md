# Lessons

## A FLIP animation covers movement, not arrival

**What happened:** "Animate sidebar reordering instead of snapping" (1be7463) made rows
slide when the recency sort reshuffles them, and it does work — verified frame by frame
on the select path. But clicking **New drawing** still looked sudden, because a row that
was not in the previous list has no old position to slide from. It was skipped entirely,
so it painted instantly at full opacity in the slot the displaced rows were still
translated over. Their text sat on top of it for the length of the animation.

**Rule:** when animating a list, enumerate all three transitions — enter, move, exit —
and say which ones are handled. `if (prevTop === undefined) return;` is the enter case
silently opting out.

## Do not judge an animation by reading the code

The FLIP implementation was textbook correct, and reading it produced four wrong theories
in a row. Sampling every row's rect and computed style once per `requestAnimationFrame`
found the defect in one run. `dev/sidebar-harness.{html,jsx}` mounts the real Sidebar for
exactly this; drive it with the `/browse` skill and diff the frame table.
