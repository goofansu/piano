/**
 * What a machine is, for every side of the wire: the ID a configured remote Piano takes, the one
 * this Piano answers as (Local), and the list `/api/machines` returns. Startup configuration,
 * the gateway's list, the browser's `/m/<id>` addresses and its switcher read this one rule, so
 * an ID one of them accepts is never one another refuses (ADR 0004, INV-07).
 */
import { Schema } from "effect";
import { MAX_MESSAGE_BYTES } from "./attachments.ts";

/** Lowercase letters and digits in runs joined by single hyphens, at most 64 characters. */
export const MachineId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(64),
);
export const isMachineId = Schema.is(MachineId);

export const Machine = Schema.Struct({ id: MachineId, name: Schema.String });
export type Machine = typeof Machine.Type;

/** This Piano itself. A configured remote may not take its ID or its name. */
export const LOCAL: Machine = { id: "local", name: "Local" };
export const isLocalId = (id: string) => id === LOCAL.id;

/** The largest frame a remote's gateway relays from the browser; it carries one prompt's text,
 * not an attachment batch. Local's own socket admits a whole message (`MAX_MESSAGE_BYTES`). */
export const PEER_FRAME_BYTES = 1024 * 1024;
/** The largest frame a machine's socket accepts: the browser sends nothing larger, and the
 * socket closes on one that is. */
export const machineFrameBytes = (id: string) =>
  isLocalId(id) ? MAX_MESSAGE_BYTES : PEER_FRAME_BYTES;

/** Local first, then each configured remote in configuration order. */
export const Machines = Schema.Array(Machine).check(
  Schema.makeFilter((machines) => machines[0]?.id === LOCAL.id || "Local must come first."),
);

export const machineList = (peers: ReadonlyArray<Machine>): Machine[] => [
  LOCAL,
  ...peers.map(({ id, name }) => ({ id, name })),
];
