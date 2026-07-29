# Note chain

**Note chain** is an opinionated note taking workflow. This plugin implements that workflow.

## Model

A **chain** is any tree of nodes connected by references: it contains a root node and every note transitively referenced from it.

**Maximum inclusion note chain** is a chain that is not included in any other chain.

### Spines and branches

Because chains overlap (they share an oldest trunk near the sink), we partition
every node into exactly one **spine** or one **branch**:

- A chain is a **spine** if it is the largest, by node count, among all chains
  that contain any of its nodes.
- A chain is **secondary** if it is not a spine. Each secondary chain splits into
  a **sub-spine** (a prefix — the oldest, shared portion, which is a prefix of
  some spine) and a **branch** (the rest — the secondary chain's unique newest
  suffix).
- **Invariant:** every node belongs to exactly one spine or one branch.

Ties (equal-size overlapping chains) are broken deterministically by root path,
so exactly one chain in each overlap group is the spine. A branch may itself
fork off another branch; in that case its parent is the immediate chain it joins,
not necessarily the spine.

The side panel lists all spines and branches; a branch's name is prefixed with
`[branch]`. The chain view of a spine shows its full chain; the chain view of a
branch shows only the branch's own nodes plus a pseudo-node linking both to the
chain view of the chain it joins into and directly to the next note (the note the
branch attaches to).

## Core idea

Core note taking guideline is:

> If a new note is related to a chain, referene the last note in that chain.

The purpose of this plugin is to make it convenient to find and reference the roots of maximum inclusion chains.

## Tags

To support tag-based approach for note organisation, we define relationship "note A references note B" this way:

> Note A references another note B if either:
> - A contains a reference to B,
> - or A contains arbitrary tag X and B contains tag X and A is created later than B.
