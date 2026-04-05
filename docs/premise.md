# Note chain

**Note chain** is an opinionated note taking workflow. This plugin implements that workflow.

## Model

**Note chain** is a set of notes defined by a root node: a note chain contains the root note and any note referenced by any other note in that chain.

**Maximum inclusion note chain** is a chain that is not included in any other chain.

## Core idea

Core note taking guideline is:

> If a new note is related to a chain, referene the last note in that chain.

The purpose of this plugin is to make it convenient to find and reference the roots of maximum inclusion chains.

## Tags

To support tag-based approach for note organisation, we define relationship "note A references note B" this way:

> Note A references another note B if either:
> - A contains a reference to B,
> - or A contains arbitrary tag X and B contains tag X and A is created later than B.
