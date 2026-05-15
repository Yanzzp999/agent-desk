# SPBS 组件关系指标与前端监控工作台设计

## Goal

输出一份中文方案任务，梳理 SPBS 不同组件关系下的监控指标目录，并设计变更 / 告警后按集群组件快速验证问题的前端落点。该任务只读调研外部文档和前端仓库，最终方案输出在当前 AgentDesk 项目中。

前端概念图参考：

![SPBS 组件监控工作台概念图](../docs/assets/spbs-component-monitor-workbench-concept.png)

## Context

只读输入目录：

- 文档目录：`/Users/yanzzp/CodeProjects/process/spbs-sre-skills/docs`
- 前端目录：`/Users/yanzzp/CodeProjects/process/space-sre-ussadmin`

当前项目资产：

- `docs/assets/spbs-component-monitor-workbench-concept.png`：由 `imagegen` 生成的 SPBS 组件监控工作台前端概念图。

文档侧主组件固定为 `meta`、`datanode`、`snapmgr`、`agent`、`spdk`。其中 `meta` 覆盖 `metacluster`、`compass`、`gateway`、`datapipe`、`etcd`；`datanode` 覆盖 `datanode`、`diskset`、`chunk`、`metalog`；`snapmgr` 覆盖 `snapshot`、`restore`；`agent` 覆盖 `cli`、`agent`、`mount`、`attach`；`spdk` 覆盖 `spdk`、`vda`、`bdev`、`io hang`。

共享指标体系需要重点整理这些 Prometheus family：`msg_latency_us`、`msg_size_bytes`、`disk_io_latency_us`、`disk_io_error_count`、`disk_io_size_total_bytes`、`volume_blocked_io_count`、`volume_qos_pend_io_count`、`volume_qos_pend_io_cost_us`、`spbs_rpc_meta_statis`、`spbs_connection_count`、`net_io_*`、`net_mem_use_bytes`、`net_ctrl_num`、`task_cnt`、`task_block_cnt`、`store_read_cnt`、`store_read_bytes`、`spbs_process_resident_memory_bytes`、`spbs_net_flink_count`、`aio_check_latency_us`、`loop_latency_us`。

组件指标方向：

- `spdk/client`：VDA monitor callback 通过 `bdev_spbs_get_all_monitor()` 汇总 `meta_syncer`、`client`、`volume_reattacher`、`io_worker` 指标。告警后优先看 `up{role="spdk"}`、`:5349`、`:9100`、`net_io_error_count`、`spbs_connection_count`、`spbs_net_flink_count`，以及目标 volume 的 `increase(volume_blocked_io_count[5m])`、`delta(volume_qos_pend_io_count[5m])`。
- `datanode`：优先看 `up{role="datanode"}`、`changes(up[2h])`、错误率、disk health、diskset health；盘 / 延迟异常继续看 `disk_io_latency_us`、`disk_io_error_count`、`dmesg`、`data_50xx` 日志、RDMA/RPC allocator 症状。
- `meta`：重点 role 是 `metacluster`、`compass`、`datapipe`、`etcd`；关注 leader / 切主、`SelectPool`、`TransferChunk`、datanode heartbeat、disk fault 上报、RPC serve 错误和 task / disk / volume 控制面状态。
- `snapmgr`：关注 snapmgr task 状态、RPC serve 错误、版本 / 进程存活；重点指标包括 `spbs_snapmgr_snap_mgr_task`、`spbs_snapmgr_snap_mgr_task_status`、`spbs_snapmgr_snap_mgr_task_chunk_num`、`spbs_snapmgr_snap_mgr_task_cur_index`、`spbs_rpc_serve_duration_seconds`、`store_read_cnt`、`store_read_bytes`，并联动 client volume 阻塞 / QoS 指标。
- `agent`：围绕 cli / agent / mount / attach 入口整理错误码、attach 失败、mount 异常、agent 进程 / 日志入口，并明确它与 `meta`、`spdk`、`client` 的边界。

前端侧已有监控接入设计：`MONITORING_DASHBOARD_EMBED_INTEGRATION.md` 和 `monitor-design/dashboard_embed.md` 建议由 Monitoring BE 注册 dashboard 并生成 `embed_url`，Product FE 只传 `client_unique_key` 与运行时变量，例如 `region`、`cluster`、`env`；前端位置可选详情区、Drawer、Tab，并保留外链兜底，不直接拼 Grafana URL。

前端现状：

- SPBS Event Center list 已有 `Alert` / `Ops Action` tabs 与 cluster-rule groups。
- Event Detail 已有 `Basic information`、`Lifecycle`、`Associated alerts`、`Event Analysis(raw)`。
- Storage Cluster Detail tabs 当前包括 `Role`、`Pool`、`Volume`、`Disk`、`Client`、`Config`、`Task`、`Disk Script`。
- V2 Cluster Detail 已有 Master / EN / PN / BG Dashboard preview/open 模式，但目前示例里有硬编码 Grafana URL，应作为交互参考，不作为最终接入方式。

推荐前端落点：

1. 优先在 SPBS Event Detail 页新增“组件监控”区块 / Tab / Drawer。这里已经有告警、生命周期、关联 alerts 和 raw analysis，最适合形成“事件上下文 -> 组件指标 -> 证据链”的闭环。
2. 其次在 Storage Cluster Detail 新增 `Monitor` Tab，作为集群日常巡检和变更后验证入口。
3. V2 Cluster Detail 的 dashboard preview 交互可参考，但应迁移到统一 `MonitorDashboardEmbed` 模式，避免业务前端直接维护 Grafana URL。

AgentDesk session 默认使用 `gpt-5.5`、`xhigh`、`fast`，每批 6 个子代理，最后集成到 `master`。

## Acceptance Criteria

- 输出一份中文方案文档，覆盖“组件关系 -> 指标目录 -> 快速验证动作 -> 前端落点”。
- 输出组件维度指标矩阵，至少覆盖 `meta`、`datanode`、`snapmgr`、`agent`、`spdk`、`shared/client`，并为每个组件列出可观测对象、核心指标、适用变更 / 告警场景、快速判断入口、可能关联组件。
- 输出变更 / 告警后的快速验证流程，输入包括 `cluster`、event/change 时间窗、component/role、affected instance/volume/disk；流程要从整体健康到组件 TopN，再到实例 / volume / disk 钻取，最后回到事件详情形成证据链。
- 输出前端落点分析，明确优先放在 SPBS Event Detail 的“组件监控”能力，其次 Storage Cluster Detail 的 `Monitor` Tab，并说明 V2 Cluster Detail dashboard preview 只能作为交互参考。
- 方案必须引用 `docs/assets/spbs-component-monitor-workbench-concept.png`，并说明它是 `imagegen` 生成的前端概念图。
- 不修改 `/Users/yanzzp/CodeProjects/process/spbs-sre-skills/docs` 和 `/Users/yanzzp/CodeProjects/process/space-sre-ussadmin`。若后续进入前端实现，必须另起实现任务。

## Subtasks

- [ ] 只读复核 SPBS 文档里的组件边界，补齐 `meta`、`datanode`、`snapmgr`、`agent`、`spdk` 的 role、日志入口、常见关联组件和运行态判断线索。
- [ ] 只读复核 shared/client 指标文档，整理可复用指标 family、label 语义、scrape 触发模型、volume/QoS/blocked IO 指标的判断方式。
- [ ] 输出组件维度指标矩阵，按组件列出可观测对象、核心指标、适用变更 / 告警场景、快速查询或看板入口、关联组件。
- [ ] 输出变更 / 告警后的快速验证流程，覆盖 cluster 级健康、组件 TopN、实例 / volume / disk 钻取、证据回写 Event Detail 的闭环。
- [ ] 只读复核前端现有 Event Center、Event Detail、Storage Cluster Detail、V2 Cluster Detail 的页面结构和监控接入设计，标注可复用交互模式与需要避免的硬编码 Grafana URL 模式。
- [ ] 输出前端落点建议，比较 Event Detail 组件监控区块 / Tab / Drawer、Storage Cluster Detail `Monitor` Tab、V2 Cluster Detail preview 模式的优先级、优缺点和接入边界。
- [ ] 设计 `MonitorDashboardEmbed` 接入约定，列出建议的 `client_unique_key` 命名、运行时变量、loading/error/no-permission/外链兜底状态，以及 Product FE 不应直接拼 Grafana URL 的约束。
- [ ] 在方案中引用 `docs/assets/spbs-component-monitor-workbench-concept.png`，说明图中的组件关系、指标分组和前端信息架构如何映射到实际页面。
- [ ] 汇总最终中文方案到当前项目文档或任务输出中，保证外部文档仓库和前端仓库没有写入变更。
