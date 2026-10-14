/**
 * A gate that runs one task at a time and drops calls while one is running
 * (a double click on Share would open LinkedIn twice; a second tap while
 * the phone's share sheet is up makes it throw). Returns whether the task
 * started. A rejection only releases the gate: handle it inside the task.
 */
export function createSingleFlight() {
  let running = false;
  return (task: () => Promise<unknown>): boolean => {
    if (running) return false;
    running = true;
    const release = () => {
      running = false;
    };
    task().then(release, release);
    return true;
  };
}
