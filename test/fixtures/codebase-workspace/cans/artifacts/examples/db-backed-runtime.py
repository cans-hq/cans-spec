# Example: a database-backed runtime (issue #67 fixture).
#
# Non-spec artifact content under the workspace: the `see:` target of the
# `L7 pgwire rewrite and 2PC commit` spec node in 09-plugins.md. Same
# class as serverless-webhook.ts — resolvable file-level artifact
# target, never spec, never scanned.
def rewrite_pgwire(message):
    return message


def commit_two_phase(txn):
    return txn.prepare()
