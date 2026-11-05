# Software Factory

The Software Factory coordinates trusted implementation issues through verified PR readiness. This operational context supports repository development rather than wallpaper or contributor behavior.

## Language

**Ready issue**:
An open implementation issue authorized for autonomous pickup by a trusted maintainer. Readiness for pickup does not by itself mean its blockers are satisfied or execution capacity is available.
_Avoid_: Unblocked issue, running job

**Prerequisite**:
An issue whose verified changes must be available before dependent work can start. A prerequisite can be satisfied by ready unmerged work or verified default-branch landing.
_Avoid_: Parent spec

**Frontier**:
The ready issues whose prerequisites are satisfied and whose required code can be made available for execution. Membership does not reserve capacity or authorize a planner to bypass admission checks.

**Plan proposal**:
A planner's advisory selection and ordering of issues, including its dependency and conflict assessments. A proposal is not an admission or a promise that selected work will start.
_Avoid_: Execution authorization

**Admission**:
The durable reservation of a distinct issue for factory execution. Continuing, repairing or restacking that issue does not create another admission.
_Avoid_: Thread launch, stage start

**Admission allowance**:
The limit on distinct issue reservations, including reservations whose external launch outcome is uncertain. It is separate from how many jobs can be active simultaneously.
_Avoid_: Concurrency

**Concurrency**:
The limit on simultaneous active work, including review, publication, CI waits and active recovery. Parked work releases active capacity without restoring its consumed admission.
_Avoid_: Admission allowance

**Job**:
The retained execution of one admitted issue, including its scope and progress through delivery. A job continues across questions, repairs and service restarts.
_Avoid_: Agent turn, PR

**Stage**:
A bounded responsibility within a job's delivery, such as implementation, independent review, publication, babysitting or CI observation. Finishing an agent turn is not necessarily completing its stage.

**Parked job**:
A job awaiting a maintainer answer whose context and progress are retained. It is neither cancelled nor a satisfied prerequisite for dependent work.
_Avoid_: Completed job, failed issue

**Continuation**:
Further execution of an existing job or recovery operation without another distinct admission. Active capacity can still be required before it proceeds.
_Avoid_: New job, new admission

**Ready for merge**:
The current PR comparison has satisfied its applicable acceptance, review and CI requirements. This is a delivery handoff, not proof that the issue has landed.
_Avoid_: Landed, merged, Done

**Landed**:
The issue's associated PR merge result is verified as part of the repository's default-branch history. Issue closure alone is not evidence of landing.
_Avoid_: Ready for merge, closed issue

**Stack**:
A linear sequence of dependent PR layers in which later work includes earlier layers' changes. It can contain changes that have not yet landed.

**Restack**:
A change to the ordering or base of issue-specific PR layers that preserves their intended changes. It can join parallel prerequisite branches or maintain descendants after a layer lands.

**Simple resolution**:
A conflict resolution that preserves functionality without substantial changes.
_Avoid_: Conflict-free restack

**Complex resolution**:
A conflict resolution requiring substantial changes to reconcile the intended behaviors of the affected issues.
_Avoid_: Simple resolution

**Uncertain outcome**:
An external operation may have succeeded, but its owning execution cannot yet establish the result. Uncertainty is not proof of failure or permission to repeat the operation.
_Avoid_: Failed operation
