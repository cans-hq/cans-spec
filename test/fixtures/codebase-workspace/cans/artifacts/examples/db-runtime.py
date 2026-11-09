# examples/db-runtime.py — issue #70 fixture miniature of the real
# db-backed-runtime.py: the cited shapes verbatim (the indented-paren
# kelir.plugins.db_proxy import, the MigrateParams model, the builder's
# PgWireRewrite/DbProxyPlugin wiring, the async main). Workspace artifact:
# never spec, never scanned (cans/ is always skipped).
"""
Database-backed secure runtime. pgwire traffic is rewritten at the L7
boundary; credentials are scoped short-lived tokens. SQLite over vsock is
forwarded to a host service — no image translation, no snapshot streaming.
"""

import asyncio
from typing import Literal

from pydantic import BaseModel, Field

import kelir
from kelir import KelirBuilder
from kelir.plugins.db_proxy import (
    DbProxyConfig, DbProxyPlugin, PgWireRewrite, SqliteOverVsock,
)


class MigrateParams(BaseModel, frozen=True):
    action: Literal["migrate"]
    schema_name: str
    target_version: int = Field(ge=1)
    dry_run: bool = False


def build_runtime(pg_host: str, pg_secret: str) -> KelirBuilder:
    builder = kelir.builder(
        vcpus=2, memory_mb=2048, driver="auto",
        rootfs_erofs="./fixtures/rootfs-migrate.erofs",
    )
    # pgwire L7 rewrite + ephemeral creds + SQLite over vsock.
    return builder.plugin(DbProxyPlugin(DbProxyConfig(
        postgres=PgWireRewrite(
            listen_port=5432,
            upstream=f"{pg_host}:5432",
            rewrite_rules=[("public.", "migrate_schema.")],
        ),
        sqlite=SqliteOverVsock(
            guest_socket="/run/kelir/db.sock",
            host_path="/var/lib/app/migrations.sqlite",
        ),
    )))


async def main() -> None:
    async with build_runtime("db.internal", "secret") as session:
        run = await session.spawn(
            "python", ["-m", "app.migrate", "--schema", "migrate"],
            cwd="/workspace/migrations",
            params=MigrateParams(action="migrate", schema_name="migrate"),
        )
        if run.exit_code != 0:
            raise SystemExit(f"migration failed: {run.exit_code}")


if __name__ == "__main__":
    asyncio.run(main())
