---
title: SpringBoot 启动流程
description: ''
date: 2026-10-21
tags:
  - Spring
draft: false
---

## 1. 完整回答

Spring Boot 的启动流程，核心就是通过 `SpringApplication.run()` 完成运行环境准备、Spring 容器初始化、自动配置、Bean 创建和 Web 服务启动，最终让应用具备处理业务请求的能力。

整个过程可以分为五个阶段。

第一阶段，初始化 SpringApplication。

从 `main()` 方法进入，创建 `SpringApplication` 对象，判断当前应用属于普通应用、Servlet Web 应用还是响应式 Web 应用，同时加载初始化器和监听器，为后续启动做准备。

第二阶段，准备运行环境。

通过 `prepareEnvironment()` 处理命令行参数、系统环境变量、`application.yml` 等配置，并确定当前激活的 Profile，例如开发环境或者生产环境。

第三阶段，创建并准备 Spring 容器。

根据应用类型创建对应的 `ApplicationContext`，关联前面准备好的环境信息，执行初始化器，并将启动类作为配置源加载到容器中。

第四阶段，刷新 Spring 容器。

这是整个启动流程最核心的阶段，通过 `refresh()` 完成组件扫描、自动配置解析、Bean 定义注册、依赖注入和 Bean 初始化。

其中，`@SpringBootApplication` 会启用组件扫描和自动配置。Spring Boot 根据项目依赖、配置属性以及容器中已有的 Bean，决定需要注册哪些组件。

如果是 Web 应用，还会在这个阶段创建并启动内嵌的 Tomcat 等 Web 服务器。

第五阶段，执行启动回调。

容器刷新完成后，发布 `ApplicationStartedEvent`，接着执行 `ApplicationRunner` 和 `CommandLineRunner`，最后发布 `ApplicationReadyEvent`，表示应用已经完成启动准备。

整个流程的关键特点是自动配置、内嵌 Web 容器和生命周期扩展机制，减少了传统 Spring 项目中的大量手动配置，适合开发独立部署的 Web 服务和微服务。

## 2. 核心原理与关键概念

### 2.1 核心启动流程

```
main()
   ↓
SpringApplication.run()
   ↓
1. 初始化 SpringApplication
   ├─ 判断应用类型
   └─ 加载初始化器、监听器
   ↓
2. prepareEnvironment()
   ├─ 解析命令行参数
   ├─ 加载外部配置
   └─ 确定激活的 Profile
   ↓
3. createApplicationContext()
   └─ 创建 Spring 应用上下文
   ↓
4. prepareContext()
   ├─ 设置 Environment
   ├─ 执行 ApplicationContextInitializer
   └─ 加载启动配置源
   ↓
5. refreshContext()
   └─ refresh()
       ├─ 解析配置类、组件扫描和自动配置
       ├─ 注册 BeanDefinition
       ├─ 注册 BeanPostProcessor
       ├─ 创建并初始化非懒加载单例 Bean
       └─ 创建并启动内嵌 Web 服务器（Web 应用）
   ↓
6. 发布 ApplicationStartedEvent
   ↓
7. 执行 ApplicationRunner / CommandLineRunner
   ↓
8. 发布 ApplicationReadyEvent
   ↓
9. 应用进入就绪状态
```

### 2.2 refresh() 的核心原理

`refresh()` 是 Spring 容器初始化的核心方法，主要完成以下工作：

1. 准备 BeanFactory：初始化和配置 Bean 工厂。

2. 处理 Bean 定义：执行 `BeanFactoryPostProcessor`，解析 `@Configuration`、`@ComponentScan`、`@Import` 等配置，注册 Bean 定义。

3. 注册 BeanPostProcessor：为后续 Bean 初始化、依赖注入、AOP 代理等提供扩展能力。

4. 初始化容器基础设施：准备事件广播器、消息源等组件，并执行 Web 容器相关初始化。

5. 创建 Bean：实例化剩余的非懒加载单例 Bean，完成依赖注入和初始化回调。

6. 完成刷新：启动相关生命周期组件，发布容器刷新事件。

需要注意，Bean 定义注册和 Bean 实例化是两个不同阶段。容器通常先确定需要管理哪些 Bean，再根据依赖关系创建对象。

### 2.3 关键概念

| 核心概念             | 作用                                                    |
| -------------------- | ------------------------------------------------------- |
| `SpringApplication`  | 组织并驱动 Spring Boot 整个启动过程                     |
| `Environment`        | 管理配置属性、环境变量和 Profile                        |
| `ApplicationContext` | Spring 应用上下文，负责 Bean 管理及事件、生命周期等功能 |
| `BeanDefinition`     | Bean 的定义信息，描述类型、作用域、依赖等               |
| `refresh()`          | 完成 Bean 定义处理、Bean 初始化和容器刷新               |
| 自动配置             | 根据依赖、配置和条件自动注册需要的组件                  |
| `ApplicationRunner`  | 在容器刷新完成后执行应用级初始化任务                    |

## 3. 高频面试追问

### 3.1 @SpringBootApplication 注解有什么作用？

`@SpringBootApplication` 是 Spring Boot 的核心启动注解，主要整合了三个注解的功能。

- `@SpringBootConfiguration`：标识当前类是 Spring Boot 配置类，可以定义和导入 Bean。

- `@EnableAutoConfiguration`：启用自动配置机制，根据项目依赖和配置条件自动注册组件。

- `@ComponentScan`：扫描启动类所在包及其子包中的 Spring 组件。

例如，启动类位于 `com.example` 包下，默认会扫描这个包及其子包中的 `@Service`、`@Controller` 等组件。

因此，通常建议把启动类放在项目的根包下，避免业务组件超出默认扫描范围。

### 3.2 Spring Boot 为什么要先准备 Environment，再创建 ApplicationContext？

因为容器的创建和配置需要依赖运行环境信息。

Spring Boot 在启动早期就会处理命令行参数、系统属性、环境变量和配置文件，并确定激活的 Profile。

这些配置会影响后续的容器初始化，比如是否启用某个功能、是否创建数据源、Web 服务监听哪个端口等。

例如，配置 `server.port=9090` 后，创建 Web 服务器时就需要读取这个属性。

所以整体顺序是：

准备 Environment → 创建 ApplicationContext → 解析配置并初始化 Bean。

这里还需要区分两个过程：配置文件等数据源会在环境准备阶段加载，而 `@ConfigurationProperties` 等 Bean 的属性绑定通常发生在后续的 Bean 创建过程中。

### 3.3 Spring Boot 的自动配置是如何实现的？

Spring Boot 自动配置的核心是 `@EnableAutoConfiguration`、自动配置类导入机制以及条件注解。

具体流程是：

1. `@EnableAutoConfiguration` 通过 `AutoConfigurationImportSelector` 参与配置类导入。

2. 从 `AutoConfiguration.imports` 文件读取候选自动配置类。

3. 根据类路径、配置属性和已有 Bean 等条件进行筛选。

4. 将符合条件的配置类纳入容器配置处理，注册相应的 Bean 定义。

常见条件注解有：

| 条件注解                    | 作用                       |
| --------------------------- | -------------------------- |
| `@ConditionalOnClass`       | 类路径存在指定类时生效     |
| `@ConditionalOnMissingBean` | 容器中缺少指定 Bean 时生效 |
| `@ConditionalOnProperty`    | 配置属性符合条件时生效     |
| `@ConditionalOnBean`        | 容器中存在指定 Bean 时生效 |

例如，引入 JDBC 相关依赖并提供数据库连接配置后，Spring Boot 可以根据条件自动创建数据源相关组件。

自动配置还支持用户自定义配置优先。 对于使用 `@ConditionalOnMissingBean` 的默认 Bean，容器中已有符合条件的用户 Bean 时，自动配置就会跳过对应默认 Bean 的注册。

继续追问：自动配置类是通过 spring.factories 加载的吗？

需要区分 Spring Boot 版本。

Spring Boot 2.7 引入了 `AutoConfiguration.imports`，Spring Boot 3.x 和 4.x 使用它注册自动配置类。

`spring.factories` 仍可用于注册部分启动扩展组件，例如应用监听器，但不再用于新版自动配置类的注册。

### 3.4 refresh() 为什么是 Spring Boot 启动中最核心的方法？

因为 `refresh()` 承担了 Spring IoC 容器从配置准备到完成初始化的主要工作。

前面的 `SpringApplication.run()` 主要负责组织启动流程、准备环境以及创建上下文。

进入 `refresh()` 后，Spring 才会集中解析配置类、处理组件扫描和自动配置、注册 Bean 定义、执行 BeanFactory 后处理器，并创建和初始化非懒加载单例 Bean。

例如，`@Autowired` 的依赖注入、`@PostConstruct` 的初始化回调，以及部分 AOP 代理创建，都与这个阶段的 Bean 生命周期处理有关。

因此，`refresh()` 体现了 Spring 容器的核心能力，包括 IoC、依赖注入、Bean 生命周期管理以及扩展机制。

### 3.5 Spring Boot 内嵌 Tomcat 是什么时候启动的？

内嵌 Tomcat 在 Spring 容器的 `refresh()` 过程中创建并启动。

Spring Boot 会根据应用类型创建对应的 Web 应用上下文，例如 Servlet Web 应用使用 `ServletWebServerApplicationContext` 相关实现。

在容器刷新过程中，Web 应用上下文通过自动配置提供的 `ServletWebServerFactory` 创建 Web 服务器。

如果使用默认的 Tomcat 配置，通常由 `TomcatServletWebServerFactory` 负责创建 Tomcat。

随后完成 Servlet、Filter、DispatcherServlet 等 Web 组件的注册与初始化，并启动 Web 服务器。

继续追问：Tomcat 启动完成，是否说明整个 Spring Boot 应用已经启动完成？

还不能直接这样判断。

Tomcat 启动只是整个应用启动过程的一部分。容器刷新完成后，还需要执行 `ApplicationRunner`、`CommandLineRunner` 等回调。

执行完成后，才会发布 `ApplicationReadyEvent` 并更新应用就绪状态。

因此，在生产环境中通常结合就绪探针判断应用是否可以正式接收业务流量。

### 3.6 Spring Boot 启动时，Bean 的创建顺序是什么？

Bean 的创建顺序主要由依赖关系、Bean 作用域和初始化策略决定。

容器会先解析配置并注册 Bean 定义，再创建需要提前初始化的 Bean。

对于默认的非懒加载单例 Bean，通常会在容器刷新过程中完成实例化。

单个 Bean 的典型生命周期是：

实例化 → 属性注入 → BeanPostProcessor 前置处理 → 初始化回调 → BeanPostProcessor 后置处理。

其中，初始化回调可以包括 `@PostConstruct`、`InitializingBean.afterPropertiesSet()` 和自定义初始化方法。

如果 A 依赖 B，容器会先保证 B 满足依赖注入要求，再完成 A 的创建。

懒加载 Bean 和原型 Bean 通常按需创建，因此不会在启动阶段统一实例化。

### 3.7 ApplicationStartedEvent 和 ApplicationReadyEvent 有什么区别？

这两个事件都用于表示启动阶段的状态，但触发时间不同。

`ApplicationStartedEvent` 在 Spring 容器刷新完成后发布，此时 `ApplicationRunner` 和 `CommandLineRunner` 还没有执行。

`ApplicationReadyEvent` 在这些 Runner 执行完成后发布，表示 Spring Boot 已完成启动准备。

事件顺序可以概括为：

`refresh()` 完成 → `ApplicationStartedEvent` → 执行 Runner → `ApplicationReadyEvent`

如果需要在 Bean 初始化完成之后执行配置检查或缓存预热，可以使用 Runner。

如果需要监听应用整体就绪状态，可以监听 `ApplicationReadyEvent`。

### 3.8 @PostConstruct、CommandLineRunner 和 ApplicationRunner 应该怎么选择？

主要根据执行时机和是否需要完整的应用上下文来选择。

`@PostConstruct` 用于单个 Bean 的初始化，例如检查自身配置、初始化内部状态。它在该 Bean 的依赖注入完成后执行，此时整个应用可能仍在启动过程中。

`CommandLineRunner` 和 `ApplicationRunner` 都在容器刷新完成后执行，适合需要多个 Bean 协作的启动任务，比如缓存预热、业务字典初始化等。

两者主要区别在于参数形式：

- `CommandLineRunner` 接收原始字符串参数。

- `ApplicationRunner` 接收封装后的 `ApplicationArguments`，可以方便地区分选项参数和普通参数。

如果存在多个 Runner，可以使用 `@Order` 或 `Ordered` 控制执行顺序。

### 3.9 Spring Boot 启动失败，通常怎么排查？

首先根据异常堆栈定位失败阶段，再检查配置、Bean 注册和依赖关系。

常见情况有三类。

第一类是配置问题，例如数据库连接地址错误、配置文件缺失或者 Profile 使用错误。

第二类是 Bean 创建问题，例如 `NoSuchBeanDefinitionException`、`UnsatisfiedDependencyException` 或循环依赖。这类问题需要检查包扫描范围、条件注解、Bean 类型及依赖关系。

第三类是 Web 服务器启动失败，例如端口被占用或者服务器配置错误。

如果怀疑自动配置没有生效，可以通过 `--debug` 查看条件评估报告，确认哪些自动配置条件匹配、哪些被跳过。

实际排查时，通常先看最底层的 `Caused by`，再结合启动日志判断失败发生在哪个阶段。

### 3.10 如果 Spring Boot 启动很慢，应该如何优化？

首先需要定位真正耗时的启动环节，再有针对性地优化。

通常会优先检查三个方面。

第一是 Bean 初始化。比如启动时建立大量外部连接、加载大量缓存数据或者执行耗时计算，都可能阻塞启动线程。

第二是依赖与自动配置。检查是否引入了多余的 Starter、是否创建了当前服务根本用不到的组件。

第三是启动任务。对于可以延迟执行的非关键任务，可以考虑在应用就绪后异步处理；对于必须完成才能提供服务的初始化，则应保留在就绪之前执行。

还可以使用 Spring Boot 的 `ApplicationStartup` 记录启动步骤，配合 Actuator 的 `startup` 端点分析耗时。

继续追问：开启懒加载能解决启动慢的问题吗？

开启 `spring.main.lazy-initialization=true` 可以减少启动阶段创建的 Bean 数量，从而缩短启动时间。

但部分 Bean 会推迟到首次使用时才初始化，可能增加第一次请求的延迟，也可能让配置错误延迟暴露。

因此，懒加载适合经过评估后有选择地使用，关键服务仍需要保证启动完成前具备必要的业务能力。

## 4. 易混淆概念对比

### 4.1 组件扫描与自动配置

| 对比维度 | 组件扫描                 | 自动配置                    |
| -------- | ------------------------ | --------------------------- |
| 核心入口 | `@ComponentScan`         | `@EnableAutoConfiguration`  |
| 主要作用 | 发现应用中的组件         | 自动注册基础设施和框架组件  |
| 发现方式 | 按包扫描注解类           | 导入候选自动配置类          |
| 常见场景 | 注册 Service、Controller | 配置数据源、Web MVC、Tomcat |

### 4.2 BeanDefinition 与 Bean

| 对比维度 | BeanDefinition     | Bean                           |
| -------- | ------------------ | ------------------------------ |
| 本质     | Bean 的配置元数据  | 实际创建的对象                 |
| 产生阶段 | 配置解析和注册阶段 | 实例化阶段                     |
| 主要作用 | 描述 Bean 如何创建 | 执行业务逻辑                   |
| 生命周期 | 定义信息由容器管理 | 由容器管理实例化、初始化和销毁 |

### 4.3 BeanFactoryPostProcessor 与 BeanPostProcessor

| 对比维度 | BeanFactoryPostProcessor  | BeanPostProcessor    |
| -------- | ------------------------- | -------------------- |
| 处理对象 | Bean 定义及 BeanFactory   | Bean 实例            |
| 执行阶段 | 普通 Bean 实例化之前      | Bean 初始化前后      |
| 主要作用 | 修改 Bean 配置元数据      | 扩展 Bean 初始化过程 |
| 典型用途 | 配置类解析、Bean 定义调整 | AOP 代理、初始化增强 |

### 4.4 ApplicationStartedEvent 与 ApplicationReadyEvent

| 对比维度        | ApplicationStartedEvent | ApplicationReadyEvent |
| --------------- | ----------------------- | --------------------- |
| 触发时间        | 容器刷新完成后          | Runner 执行完成后     |
| Runner 是否执行 | 尚未执行                | 已执行                |
| 表示状态        | 容器已完成启动          | 应用完成启动准备      |
| 典型用途        | 监听容器启动完成        | 监听应用就绪状态      |

### 4.5 CommandLineRunner 与 ApplicationRunner

| 对比维度 | CommandLineRunner | ApplicationRunner        |
| -------- | ----------------- | ------------------------ |
| 执行时机 | 容器刷新完成后    | 容器刷新完成后           |
| 参数类型 | `String... args`  | `ApplicationArguments`   |
| 参数处理 | 自行解析原始参数  | 支持获取选项和非选项参数 |
| 适用场景 | 简单启动任务      | 需要解析参数的启动任务   |

两者都在 `ApplicationReadyEvent` 之前执行，也都可以使用 `@Order` 控制顺序。

## 5. 总结

Spring Boot 启动的核心入口是 `SpringApplication.run()`，主要完成环境准备、应用上下文创建、容器刷新和启动回调。整个流程最关键的是 `refresh()`，它负责配置解析、Bean 定义注册、依赖注入和 Bean 初始化，Web 应用还会在这个阶段启动内嵌服务器。同时，Spring Boot 通过自动配置减少手动配置，通过生命周期事件和 Runner 提供启动扩展能力。需要区分的是，Spring 容器刷新完成和应用完全就绪是两个不同的时间点，只有启动回调执行完成并进入就绪状态后，应用才算完成启动准备。
