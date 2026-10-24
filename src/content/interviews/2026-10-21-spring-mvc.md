---
title: Spring MVC
description: ''
date: 2026-10-21
tags:
  - Spring
draft: false
---

## 1. 完整回答

Spring MVC 是 Spring Framework 提供的一个基于 Servlet 规范的 Web 开发框架，采用 MVC 设计模式，主要负责接收 HTTP 请求、调用业务逻辑以及生成 HTTP 响应。它通过分离请求处理、业务逻辑和视图展示，降低各层之间的耦合。

Spring MVC 的核心是 DispatcherServlet 前端控制器，采用统一入口、组件协作的方式处理请求。

当客户端发送请求时，请求首先经过 Servlet 容器和过滤器，然后进入 DispatcherServlet。DispatcherServlet 通过 HandlerMapping 找到对应的 Controller 处理方法，再由 HandlerAdapter 完成参数解析、类型转换以及方法调用。

Controller 执行完成后，根据返回值采用不同的响应方式。如果返回页面视图，就通过 ViewResolver 解析视图并渲染；如果返回 JSON 数据，就通过 HttpMessageConverter 将 Java 对象序列化后写入 HTTP 响应。

另外，Spring MVC 还提供了拦截器、参数校验、全局异常处理等机制，能够统一处理日志、请求校验和异常响应。

它的主要特点是职责分离、注解式开发、扩展性强，并且能够与 Spring 生态无缝集成。目前主要用于前后端分离的 RESTful API、传统 Web 应用以及基于 Spring Boot 的后端服务。

## 2. 核心原理与关键概念

### 2.1 核心原理

Spring MVC 的核心采用 前端控制器模式，通过 DispatcherServlet 统一协调各个组件完成请求处理。

第一步：接收请求

客户端 → Servlet 容器 → Filter 过滤器 → DispatcherServlet

Servlet 容器接收 HTTP 请求，经过匹配的过滤器链后，将请求交给 DispatcherServlet。

第二步：查找处理器

DispatcherServlet → HandlerMapping → HandlerExecutionChain

HandlerMapping 根据请求路径、HTTP 方法等条件查找匹配的处理器，并返回包含处理器和拦截器的执行链。

第三步：执行 Controller

Interceptor.preHandle → HandlerAdapter → Controller

拦截器允许请求继续后，HandlerAdapter 负责调用对应的 Controller 方法。

在方法执行前，Spring MVC 会通过参数解析器、数据绑定和类型转换等机制准备方法参数，并在适用时执行参数校验。

第四步：处理返回值

根据 Controller 的返回方式，分成两条路径：

- 页面响应：Controller → postHandle → ViewResolver → View 渲染 → afterCompletion

- REST 响应：Controller → HttpMessageConverter 写入响应体 → postHandle → afterCompletion

对于 `@ResponseBody` 或 `ResponseEntity`，响应体通常在 HandlerAdapter 内部完成写入，无需经过 ViewResolver。

第五步：异常处理

请求处理过程中发生异常时，DispatcherServlet 可以通过 HandlerExceptionResolver 将异常转换为错误响应。

全局异常处理通常基于 `@RestControllerAdvice` 和 `@ExceptionHandler` 实现。

### 2.2 关键概念

| 核心组件                 | 作用                                                           |
| ------------------------ | -------------------------------------------------------------- |
| DispatcherServlet        | 前端控制器，统一接收请求并协调处理流程                         |
| HandlerMapping           | 根据请求条件查找对应的处理器和拦截器                           |
| HandlerAdapter           | 适配并执行处理器，完成参数解析和返回值处理                     |
| Controller               | 接收请求参数，调用业务逻辑并返回结果                           |
| HttpMessageConverter     | 完成 HTTP 请求体与响应体的数据转换，例如 JSON 与 Java 对象互转 |
| ViewResolver             | 将逻辑视图名解析为具体视图，用于页面渲染                       |
| HandlerExceptionResolver | 解析请求处理异常并生成相应结果                                 |

## 3. 高频面试追问

### 3.1 DispatcherServlet 为什么需要 HandlerMapping 和 HandlerAdapter？

主要是为了分离请求路由和处理器执行逻辑，降低 DispatcherServlet 与具体 Controller 实现之间的耦合。

HandlerMapping 负责找到由谁处理请求，例如根据 `@GetMapping("/users/{id}")` 找到对应的 Controller 方法。

HandlerAdapter 负责决定如何执行这个方法，包括解析 `@PathVariable`、`@RequestBody` 等参数，以及处理方法返回值。

这样 DispatcherServlet 只需要负责整体调度，不需要关心不同处理器的具体调用方式。

这种设计也体现了适配器模式的思想，让 Spring MVC 可以支持不同类型的处理器，并保持较好的扩展性。

### 3.2 @Controller 和 @RestController 有什么区别？

核心区别是方法返回值的默认处理方式不同。

`@Controller` 主要用于传统 MVC 页面开发。方法返回字符串时，默认会将字符串作为逻辑视图名交给视图解析器。

`@RestController` 相当于 `@Controller` 和 `@ResponseBody` 的组合，默认将方法返回值写入 HTTP 响应体。

例如，查询用户接口返回一个 User 对象，使用 `@RestController` 时，Spring MVC 可以通过 JSON 消息转换器把对象序列化后返回。

如果使用 `@Controller`，也可以在具体方法上添加 `@ResponseBody` 实现相同效果。

另外，`ResponseEntity` 可以进一步控制 HTTP 状态码、响应头和响应体，适合需要明确返回 201、404 等状态码的接口。

### 3.3 @RequestParam、@PathVariable、@RequestBody 和 @ModelAttribute 有什么区别？

这几个注解主要区别在于参数的数据来源和绑定方式。

`@RequestParam` 用于获取请求参数，包括 URL 查询参数和表单参数。例如 `/users?page=1` 中的 page。

`@PathVariable` 用于获取 URL 路径中的变量，例如 `/users/100` 中的用户 ID。

`@RequestBody` 用于读取 HTTP 请求体，并通过 HttpMessageConverter 转换为 Java 对象，常用于接收 JSON 数据。

`@ModelAttribute` 主要用于把请求参数绑定到对象属性上，适合表单提交，也支持其他符合绑定规则的请求数据。

实际开发中，GET 查询接口经常使用 `@RequestParam` 和 `@PathVariable`，接收 JSON 的 POST、PUT 等接口通常使用 `@RequestBody`。

### 3.4 Spring MVC 是如何完成 JSON 数据转换的？

Spring MVC 主要通过 HttpMessageConverter 消息转换器完成 HTTP 请求体与 Java 对象之间的转换。

接收 JSON 请求时，`@RequestBody` 会触发请求体读取，Spring MVC 根据请求的 Content-Type、目标参数类型等信息选择合适的消息转换器，通常由 Jackson 完成 JSON 反序列化。

Controller 返回对象时，`@ResponseBody` 会触发响应体写入，根据返回值类型、客户端 Accept 等条件选择合适的转换器，将对象序列化为 JSON。

例如，客户端提交用户 JSON 数据，服务端先转换为 User 对象，完成业务处理后，再将返回对象转换成 JSON。

这里需要注意，Content-Type 表示发送的数据类型，Accept 表示期望接收的数据类型。两者都会影响消息转换和内容协商。

继续追问：为什么 @RestController 返回 JSON 不需要 ViewResolver？

因为 `@RestController` 默认具有 `@ResponseBody` 语义，Spring MVC 会通过返回值处理器调用 HttpMessageConverter，直接把结果写入响应体。ViewResolver 主要负责传统页面的逻辑视图名解析，因此这个流程不需要经过它。

### 3.5 Filter 和 Interceptor 有什么区别？

两者都能对请求进行前置和后置处理，但所属层次、作用范围和能够获取的信息不同。

Filter 属于 Servlet 规范，由 Servlet 容器管理和调用，在请求进入目标 Servlet 之前执行，也可以在调用链返回后处理响应。

Interceptor 属于 Spring MVC，围绕 Handler 的执行进行拦截，可以获取匹配到的 Handler 信息。

Interceptor 主要提供三个方法：

- `preHandle`：Controller 执行前调用，返回 false 可以阻止后续处理。

- `postHandle`：Handler 正常执行完成后调用。

- `afterCompletion`：请求处理完成后调用，适合清理资源。

实际开发中，编码处理、请求包装以及安全过滤通常放在 Filter 层；接口耗时统计、基于 Handler 的日志记录等可以使用 Interceptor。

对于统一认证授权，更适合使用 Spring Security 等基于过滤器链的安全机制。

继续追问：postHandle 能修改 Controller 返回的 JSON 吗？

通常不能依赖 postHandle 修改 JSON 响应。对于 `@ResponseBody`，响应体可能在 postHandle 调用前已经写出。需要统一修改响应体时，可以使用 `ResponseBodyAdvice`；需要控制状态码和响应头时，可以使用 `ResponseEntity` 等机制。

### 3.6 Spring MVC 的全局异常处理是怎么实现的？

Spring MVC 通过 HandlerExceptionResolver 异常解析机制处理请求执行过程中的异常。

当 Controller 或相关请求处理环节发生异常时，DispatcherServlet 会交给异常解析器尝试处理。

实际项目中通常使用 `@RestControllerAdvice` 配合 `@ExceptionHandler`，根据异常类型统一生成 HTTP 响应。

例如，业务参数错误返回 400，资源不存在返回 404，未处理的服务端异常通常返回 500，同时统一响应结构和日志记录方式。

异常处理方法可以定义在 Controller 内部，也可以定义在全局 Advice 中。Controller 内部匹配的异常处理方法优先于全局处理方法。

需要注意，全局异常处理主要覆盖 Spring MVC 的请求处理范围，Filter 中提前抛出的异常通常需要通过过滤器链或 Servlet 容器的异常处理机制解决。

### 3.7 Spring MVC 如何实现参数校验？

Spring MVC 通常结合 Jakarta Bean Validation 实现参数校验。

首先在请求对象的字段上声明约束，例如 `@NotNull`、`@NotBlank`、`@Size`。

然后在 Controller 的对象参数上使用 `@Valid` 或 `@Validated`，Spring MVC 会在参数绑定完成后执行相应的校验。

对于常见的 `@Valid @RequestBody` 对象校验，如果校验失败且没有紧随其后的 BindingResult 接收错误，通常会抛出 `MethodArgumentNotValidException`，默认对应 400 响应。

如果使用方法级约束校验，还可能产生 `HandlerMethodValidationException`。

实际项目中一般通过全局异常处理统一返回字段错误信息，同时还需要在 Service 层继续校验涉及数据库状态、业务规则和权限的条件。

### 3.8 Spring MVC 的 Controller 是线程安全的吗？

Controller 默认是 Spring 管理的单例 Bean，但单例本身不保证线程安全。

在传统 Servlet 请求处理模型中，多个请求可以由不同线程并发执行同一个 Controller 实例的方法。

如果 Controller 只使用局部变量，并通过 Service 完成业务处理，通常不会产生 Controller 自身的共享状态问题。

但如果把请求相关的数据存储在 Controller 的可变成员变量中，就可能发生数据竞争。

例如，将当前用户 ID 放在 Controller 的成员变量中，多个并发请求可能相互覆盖。

因此，Controller 通常应该设计成无状态组件，请求数据保存在方法参数和局部变量中，共享状态则通过合适的并发控制或存储机制管理。

### 3.9 Spring MVC 和 Spring WebFlux 有什么区别？

核心区别在于请求处理模型和对阻塞操作的假设不同。

Spring MVC 基于 Servlet，默认采用同步阻塞式处理模型。请求一般由 Servlet 容器线程执行，遇到阻塞式数据库查询或远程调用时，当前线程可能一直等待。

Spring WebFlux 采用响应式非阻塞模型，支持 Reactive Streams 背压机制，能够在大量 I/O 等待场景中减少线程占用。

Spring MVC 适合传统业务系统，以及主要使用 JDBC、JPA 等阻塞式组件的项目。

WebFlux 更适合具备端到端非阻塞调用链、并发连接较多且 I/O 等待明显的场景。

WebFlux 并不意味着单次请求一定更快。如果底层大量使用阻塞式组件，直接改用 WebFlux 通常也无法充分发挥优势。

继续追问：Spring MVC 支持异步请求吗？

支持。Spring MVC 可以利用 Servlet 异步机制，通过 `Callable`、`DeferredResult` 等方式释放最初处理请求的容器线程，等异步结果准备好后再完成响应。

不过，`Callable` 中的阻塞业务操作仍然会占用执行线程，因此 Spring MVC 的异步处理与 WebFlux 的端到端非阻塞模型仍有区别。

### 3.10 项目中 Spring MVC 接口出现 404、405、415、406，应该怎么排查？

这几个状态码通常对应请求匹配或内容协商阶段的不同问题。

| 状态码 | 含义                       | 常见排查方向                                    |
| ------ | -------------------------- | ----------------------------------------------- |
| 404    | 未找到目标资源             | URL 路径、Controller 映射、上下文路径、网关路由 |
| 405    | HTTP 方法不被支持          | GET、POST 等方法与映射声明是否一致              |
| 415    | 请求媒体类型不被支持       | Content-Type、consumes、请求体转换器            |
| 406    | 无法生成客户端可接受的响应 | Accept、produces、响应转换器                    |

实际排查时，首先确认请求路径和 HTTP 方法，然后查看 `@RequestMapping` 的匹配条件。

如果路由匹配没有问题，再检查 Content-Type、Accept 和消息转换器配置。

例如，接口声明只接收 `application/json`，客户端却发送 `text/plain`，就可能出现 415。

最后结合 Spring MVC 的请求映射日志和异常信息，可以进一步判断问题出在路由匹配、参数转换还是响应生成阶段。

## 4. 易混淆概念对比

### 4.1 HandlerMapping 与 HandlerAdapter

| 对比项     | HandlerMapping               | HandlerAdapter                 |
| ---------- | ---------------------------- | ------------------------------ |
| 核心职责   | 查找处理器                   | 执行处理器                     |
| 解决的问题 | 请求交给谁处理               | 处理器如何调用                 |
| 典型实现   | RequestMappingHandlerMapping | RequestMappingHandlerAdapter   |
| 主要工作   | 请求条件匹配、构建执行链     | 参数解析、调用方法、处理返回值 |

### 4.2 @Controller 与 @RestController

| 对比项             | @Controller        | @RestController  |
| ------------------ | ------------------ | ---------------- |
| 默认返回值处理     | 支持逻辑视图名解析 | 返回值写入响应体 |
| 常见用途           | 服务端页面渲染     | RESTful API      |
| 使用 @ResponseBody | 按方法添加         | 默认具备         |
| ViewResolver       | 返回视图时使用     | 通常不使用       |

### 4.3 @RequestParam、@RequestBody 与 @ModelAttribute

| 对比项   | @RequestParam      | @RequestBody       | @ModelAttribute      |
| -------- | ------------------ | ------------------ | -------------------- |
| 数据来源 | 查询参数、表单参数 | HTTP 请求体        | 请求参数等可绑定数据 |
| 处理机制 | 参数解析与类型转换 | 消息转换器反序列化 | 数据绑定器           |
| 常见场景 | 分页、筛选         | JSON 接口          | 表单对象绑定         |

### 4.4 Filter 与 Interceptor

| 对比项               | Filter                    | Interceptor               |
| -------------------- | ------------------------- | ------------------------- |
| 所属规范             | Servlet                   | Spring MVC                |
| 执行位置             | Servlet 调用链            | Handler 执行链            |
| 作用范围             | 匹配的 Servlet 请求及分派 | Spring MVC 匹配的 Handler |
| 是否直接获取 Handler | 否                        | 是                        |
| 典型用途             | 安全过滤、请求包装        | 接口日志、耗时统计        |

### 4.5 Spring MVC 与 Spring WebFlux

| 对比项           | Spring MVC         | Spring WebFlux                |
| ---------------- | ------------------ | ----------------------------- |
| 技术基础         | Servlet            | 响应式 Web 栈                 |
| 默认处理模型     | 同步阻塞           | 异步非阻塞                    |
| 线程模型         | Servlet 容器线程池 | 通常使用少量事件循环线程      |
| 阻塞式数据库访问 | 适合               | 需要额外处理                  |
| 主要适用场景     | 常规业务系统       | 端到端非阻塞、高 I/O 并发系统 |

### 4.6 Spring MVC 与 Spring Boot

| 对比项       | Spring MVC                   | Spring Boot                                    |
| ------------ | ---------------------------- | ---------------------------------------------- |
| 定位         | Web 开发框架                 | Spring 应用快速构建与配置工具                  |
| 核心职责     | 请求路由、参数绑定、响应处理 | 自动配置、依赖管理、应用启动                   |
| 两者关系     | 提供 Web 请求处理能力        | 可以自动配置并集成 Spring MVC                  |
| 是否相互依赖 | 可独立于 Spring Boot 使用    | 可以使用 Spring MVC，也可以选择其他 Web 技术栈 |

## 5. 总结

Spring MVC 是一个基于 Servlet 的 Web 开发框架，核心采用 DispatcherServlet 前端控制器模式，通过 HandlerMapping 查找处理器、HandlerAdapter 执行 Controller，再根据返回值完成页面渲染或 JSON 响应。它的主要优势是职责分离、注解开发方便、扩展机制完善，并且能够与 Spring Boot 等技术集成。Spring MVC 默认采用同步阻塞式处理模型，同时支持 Servlet 异步请求，适合大多数常规 Java Web 业务系统；对于端到端非阻塞的高并发 I/O 场景，可以考虑 Spring WebFlux。
