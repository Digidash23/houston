/**
 * The provider/model a routine's fired turn carries, read through the host's
 * own ladder (`routinePin` in `@houston/domain`, which the scheduler and the
 * trigger fire path call). A surface that names a routine's model reads it
 * here, so the pin it shows is the pin that runs: a Rust-era provider alias
 * maps to its pi id, a retired model to the model it fires on, and a model
 * the ladder cannot map is dropped, leaving the agent's own model to run.
 */
export { type RoutinePin, routinePin as routineFirePin } from "@houston/domain";
