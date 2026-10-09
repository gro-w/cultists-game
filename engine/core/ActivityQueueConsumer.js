/** Runs the next unresolved instance in a queue through one injected execution path. */
export class ActivityQueueConsumer {
  constructor({ queueRegistry, activityDefinitionStore, activityExecutionService, execute } = {}) {
    this.queueRegistry = queueRegistry;
    this.activityDefinitionStore = activityDefinitionStore;
    this.activityExecutionService = activityExecutionService;
    this.execute = execute;
  }

  current(queueId) {
    return this.queueRegistry.get(queueId)?.current() || null;
  }

  consume(queueId) {
    const queue = this.queueRegistry.get(queueId);
    const instance = queue?.current();
    if (!queue || !instance) return null;
    const definition = this.activityDefinitionStore.get(instance.activityId);
    if (!definition) return null;
    if (this.execute) return this.execute({ queue, instance, definition });
    return this.activityExecutionService.run({ queue, instance, definition });
  }
}

export default ActivityQueueConsumer;
