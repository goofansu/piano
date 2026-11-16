import { Schema } from "effect";
import { MAX_MESSAGE_BYTES } from "./attachments.ts";

export const MachineId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  Schema.isMaxLength(64),
);
export const isMachineId = Schema.is(MachineId);

export const Machine = Schema.Struct({ id: MachineId, name: Schema.String });
export type Machine = typeof Machine.Type;

export const LOCAL: Machine = { id: "local", name: "Local" };
export const isLocalId = (id: string) => id === LOCAL.id;

export const PEER_FRAME_BYTES = 1024 * 1024;
export const machineFrameBytes = (id: string) =>
  isLocalId(id) ? MAX_MESSAGE_BYTES : PEER_FRAME_BYTES;

export const Machines = Schema.Array(Machine).check(
  Schema.makeFilter((machines) => machines[0]?.id === LOCAL.id || "Local must come first."),
);

export const machineList = (peers: ReadonlyArray<Machine>): Machine[] => [
  LOCAL,
  ...peers.map(({ id, name }) => ({ id, name })),
];
