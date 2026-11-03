# 设计技术依据

查阅时间: 2026-11-03T23:12:12+08:00

我查的是MySQL 8.4官方手册, 用来核对设计中的事务与索引语义. 业务规则仍来自本项目的26条需求.

- [Locking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html): 需要读后更新的库存和客房使用事务内锁定读取, 不用普通快照读取代替并发保护.
- [Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html): REPEATABLE READ的普通一致读共享同一事务快照. 管理汇总采用只读一致快照, 不混入该事务自己的写入.
- [CREATE TABLE - UNIQUE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html): 可空唯一键允许多条NULL. 可用生成的当前在住房号列加唯一约束, 保留历史分房而阻止两个活动分房占同一房号.
- [Deadlocks in InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-deadlocks.html): 统一写入顺序并缩短事务能减少死锁, 不能声称完全消除. 失败事务仍需整体回滚并用原提交标识重试.

- [Locking Functions](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html): 命名锁属于连接会话, 提交和回滚不自动释放. 取锁返回值和显式释放需要纳入专用连接生命周期; 锁名长度不超过64字符.
- [InnoDB Error Handling](https://dev.mysql.com/doc/refman/8.4/en/innodb-error-handling.html): 语句失败与整事务回滚须区分, 应用工作单元显式回滚Tbiz, 不把默认锁等待超时当作全事务自动恢复.
