/**
 * What a machine is, for every side of the wire: the ID a configured remote Piano takes, the one
 * this Piano answers as (Local), and the list `/api/machines` returns. Startup configuration,
 * the gateway's list, the browser's `/m/<id>` addresses and its switcher read this one rule, so
 * an ID one of them accepts is never one another refuses (ADR 0004, INV-07).
 */
import { Schema } from "effect";

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

/** Local first, then each configured remote in configuration order. */
export const Machines = Schema.Array(Machine).check(
  Schema.makeFilter((machines) => machines[0]?.id === LOCAL.id || "Local must come first."),
);

export const machineList = (peers: ReadonlyArray<Machine>): Machine[] => [
  LOCAL,
  ...peers.map(({ id, name }) => ({ id, name })),
];
