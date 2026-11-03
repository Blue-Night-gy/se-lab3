# 需求到设计与界面的追溯

基线: b/requirements.md的26条需求. 页面编号来自实际读取的design/screens.json, 已包含UI-24工作人员日志权限拒绝. 图号以UML源文件标题为准. UI列是操作入口, 数据库与压力场景在boundary-cases.md中列作后续实现的验证任务.

| 需求 | 设计规则 | 对象或接口 | UML | UI入口 | 边界情境 |
| --- | --- | --- | --- | --- | --- |
| REQ-001 | 本人订单归属在读取和写入时都核对 | AccessScope / 本人订单接口 | B01, B06 | UI-01, UI-06, UI-07, UI-08, UI-09, UI-10 | BC-18 |
| REQ-002 | 维护及前台操作只限授权酒店, 日志权另授 | hotel_grant / FrontDeskService | B01, B02 | UI-01, UI-11, UI-12, UI-13, UI-14, UI-15, UI-17, UI-19, UI-24 | BC-13, BC-18 |
| REQ-003 | 平台酒店, 账号, 查询及统计; 异常不越过订单守卫 | 管理员接口 / AccessScope | B01, B08 | UI-01, UI-16, UI-18, UI-19, UI-20, UI-21 | BC-18 |
| REQ-004 | 唯一日售记录, 缺价/停售不接受目标住宿 | DayOffer / daily-offers | B01, B02 | UI-02, UI-03, UI-14, UI-17, UI-23 | BC-02 |
| REQ-005 | 酒店, 房型, 订单编号与房型日记录唯一 | 数据库唯一键与复合FK | B02, B03 | UI-03, UI-14, UI-17, UI-18 | BC-02, BC-13 |
| REQ-006 | 全程min余量, q乘逐晚价; 每间每晚区间及人数假设 | SearchQuoteService / availability | B01, B03 | UI-02, UI-03, UI-23 | BC-01, BC-02 |
| REQ-007 | 待确认即逐夜占q, 退房日排除, 变价先征询 | Reservation / BookedNight / reservations | B02, B03, B06 | UI-03, UI-04, UI-05, UI-07, UI-22, UI-23 | BC-01, BC-02, BC-03 |
| REQ-008 | 五状态与受控方法, 更正入住人与住宿变化分路 | Reservation / 前台及本人命令 | B02, B04 | UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, UI-12, UI-13 | BC-07, BC-08, BC-09, BC-13 |
| REQ-009 | 成交夜价快照保留, 新住宿整段重价 | BookedNight / PriceQuote / audit_change | B02, B03, B07 | UI-04, UI-05, UI-06, UI-07, UI-08, UI-09 | BC-01, BC-03, BC-10 |
| REQ-010 | 并集锁和delta=D-O, 新期限只在成功住宿变化重开 | InventoryDeltaPlanner / stay接口 | B02, B04, B07 | UI-08, UI-09, UI-16 | BC-08, BC-09, BC-10, BC-11, BC-21 |
| REQ-011 | 普通取消按18点和实际入住取早, 逐夜单次释放 | Reservation.cancel / cancel接口 | B04, B07 | UI-10, UI-16, UI-23 | BC-12 |
| REQ-012 | 20分钟到点取消, 版本任务及当前订单兜底扫描 | ConfirmationWorker / confirmation_job | B04, B07, B08 | UI-07, UI-08, UI-09, UI-10, UI-11, UI-23 | BC-07, BC-08, BC-09, BC-11, BC-21 |
| REQ-013 | 日售排他行锁, 不依赖旧余量 | DayOffer / BookingService | B02, B06 | UI-04, UI-14 | BC-06 |
| REQ-014 | 同号绑定内容, 同一结果; 新接受用新号 | Submission / OperationCoordinator | B05, B06 | UI-04, UI-05, UI-07, UI-22 | BC-03, BC-04, BC-22 |
| REQ-015 | 只比较五项且仅待确认/已确认, 姓名不同仍提醒 | decision_token / 同程策略 | B05, B06 | UI-22 | BC-05 |
| REQ-016 | q个不同同店同型空闲房, 全部入住/退房 | Room / RoomAssignment / check-in/out | B02, B03, B04 | UI-12, UI-13, UI-15 | BC-13, BC-14 |
| REQ-017 | 范围阻止新单, 旧单清单交叠产生且不批量取消 | SupplyBlock / CoordinationCase | B01, B02 | UI-14, UI-15, UI-16, UI-18 | BC-15 |
| REQ-018 | 当前计划入住自然日, 含两端, 非下单日 | ReportingService / admin/orders | B01 | UI-11, UI-20 | BC-16 |
| REQ-019 | 当前住宿交叠, 同一快照三指标, 有效间夜乘q | stay-statistics / reservation当前行程 | B01, B03 | UI-20 | BC-17 |
| REQ-020 | 成功审计同事务, 失败另存, operationId去重 | AuditService / audit_operation/change | B01, B06, B07 | UI-13, UI-14, UI-15, UI-16, UI-19, UI-21, UI-24 | BC-19, BC-22 |
| REQ-021 | 独立酒店日志授权, 人员权限日志仅管理员 | VIEW_OPERATION_LOG / audit-logs | B01 | UI-19, UI-21, UI-24 | BC-18 |
| REQ-022 | 18点即时截止, 报价再变再接受, 更正不重计价 | Reservation守卫 / PriceQuote | B04, B05, B07 | UI-05, UI-08, UI-09, UI-10, UI-16, UI-22, UI-23 | BC-03, BC-08, BC-12, BC-21 |
| REQ-023 | 入口和对象范围同时检查, 撤权下次请求生效 | AccessScope / hotel_grant | B01, B06 | UI-01, UI-11, UI-12, UI-17, UI-18, UI-19, UI-21, UI-23, UI-24 | BC-18 |
| REQ-024 | 所有夜晚, 订单, 子记录及成功审计整体生效 | UnitOfWork / InnoDB事务 | B06, B07, B08 | UI-04, UI-05, UI-08, UI-10, UI-12, UI-13, UI-14, UI-22, UI-23 | BC-06, BC-10, BC-13, BC-19, BC-22 |
| REQ-025 | 已提交订单/日志持久化, 未提交回滚, 按原号恢复 | operation_request / 数据库事务日志 | B06, B07, B08 | UI-07, UI-20, UI-21 | BC-20, BC-22 |
| REQ-026 | 固定数据集10并发100次, 95次正确且2秒内 | 只读availability / 查询索引 | B01, B08 | UI-02 | BC-20 |

日志拒绝的直接界面是UI-24, 对应工作人员酒店范围和独立日志授权. UI-23中的顾客拒绝提示支撑顾客状态或本人订单范围, 不将其解释为工作人员日志检索页.
