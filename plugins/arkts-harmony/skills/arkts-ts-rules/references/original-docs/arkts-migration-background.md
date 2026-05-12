# ArkTS语法适配背景
ArkTS在保留TypeScript基本语法风格的基础上，通过规范强化静态检查和分析，使开发者在程序开发阶段能检测出更多错误，提升程序稳定性和运行性能。
## 程序稳定性
动态类型语言如JavaScript虽能提升开发效率，但容易在运行时引发非预期错误。TypeScript通过类型标注机制使编译器能在编译时检测多数类型错误，但其非强制类型系统仍存在局限。ArkTS通过强制静态类型系统克服这一缺陷，实施更严格的类型验证机制，最大限度减少运行时错误。
**显式初始化类的属性**
ArkTS要求类的所有属性在声明时或在构造函数中显式初始化，与TS的`strictPropertyInitialization`一致。
非严格模式TS代码：
```typescript
class Person {
  name: string; // undefined
  
  setName(n: string): void { this.name = n; }
  
  getName(): string {
  // 开发者使用"string"作为返回类型，这隐藏了name可能为"undefined"的事实。
  // 更合适的做法是将返回类型标注为"string | undefined"，以告诉开发者这个API所有可能的返回值的类型。
    return this.name;
  }
}

let buddy = new Person()
// 假设代码中没有对name的赋值，例如没有调用"buddy.setName('John')"
buddy.getName().length; // 运行时异常：name is undefined
```
ArkTS要求属性显式初始化：
``` TypeScript
class Person {
  name: string = ''; // undefined

  setName(n: string): void { this.name = n; }

  // 类型为"string"，不可能为"null"或者"undefined"。
  getName(): string { return this.name; }
}
// ...
  let buddy = new Person()
  // 假设代码中没有对name的赋值，例如没有调用"buddy.setName('John')"。
  let len = buddy.getName().length; // 0, 没有运行时异常。
```
如果`name`可以是`undefined`，其类型应在代码中精确标注：
``` TypeScript
class Person1 {
  name?: string; // 可能为undefined。

  setName(n: string): void { this.name = n; }

  getName(): string | undefined { // 返回类型匹配name的类型。
    return this.name;
  }
}
// ...
  let buddy = new Person1()
  // 假设代码中没有对name的赋值，例如没有调用"buddy.setName('John')"。

  let len = buddy.getName()?.length; // 编译成功，没有运行时错误。
```
## 程序性能
动态类型语言需要在运行时检查对象类型以保证正确性。例如JavaScript不允许访问`undefined`的属性。所有JS引擎都会执行这类检查：值不是`undefined`则可访问属性，否则抛出异常。现代引擎虽可优化此类操作，但仍有无法消除的运行时检查，导致程序变慢。TypeScript代码总是先编译成JavaScript，因此存在相同问题。ArkTS通过静态类型检查，将代码编译成方舟字节码而非JS，运行更快且易于进一步优化。
**Null Safety**
``` TypeScript
function notify(who: string, what: string) {
  console.info(`Dear ${who}, a message for you: ${what}`);
}

// ...
  notify('Jack', 'You look great today');
```
大多数情况下，`notify`接受两个`string`变量产生新字符串。但传入`notify(null, undefined)`会怎样？
程序仍正常运行，输出`Dear null, a message for you: undefined`。但为保障该场景正确性，引擎运行时持续进行类型检查，实现机制类似：
```typescript
function __internal_tostring(s: any): string {
  if (typeof s === 'string')
    return s;
  if (s === undefined)
    return 'undefined';
  if (s === null)
    return 'null';
  // ...
}
```
若`notify`是高负载关键逻辑的一部分，频繁执行`__internal_tostring`类检查会带来显著的性能开销。
如果可以保证运行时只有`string`类型值传入`notify`？此时`__internal_tostring`检查就是多余的。这称为"null-safety"（空安全），核心目的是确保`null`不能作为合法字符串值。ArkTS支持这一特性，类型不匹配的代码在编译阶段即被拦截。
```typescript
function notify(who: string, what: string) {
  console.info(`Dear ${who}, a message for you: ${what}`);
}

notify('Jack', 'You look great today');
notify(null, undefined); // 编译时错误
```
TS通过`strictNullChecks`编译选项实现此特性，但因TS被编译成JS，严格null检查仅在编译时起效。ArkTS强制进行严格null检查，为引擎提供更多类型保证，有助于优化性能。
## .ets代码兼容性
API version 10之前，ArkTS（.ets文件）完全遵循标准TypeScript规范。从API version 10 Release起，明确定义ArkTS语法规则，SDK增加对.ets文件的ArkTS语法检查，通过编译告警或编译失败提示开发者适配。
根据`compatibleSdkVersion`策略：
- `compatibleSdkVersion >= 10`为标准模式。所有.ets文件必须严格遵循ArkTS语法规则，违规则编译失败。
- `compatibleSdkVersion < 10`为兼容模式。语法违规以warning提示，兼容模式下仍可编译成功，但需完全适配后方可在标准模式编译。
## 支持与TS/JS的交互
ArkTS支持与TS/JS的高效互操作。当前版本ArkTS运行时兼容动态类型对象语义。在互操作场景中，直接复用TS/JS的数据和对象作为ArkTS实体时，可能规避静态类型检查，引发运行时异常或额外性能损耗。
```typescript
// lib.ts
export class C {
  v: string; // 在TS严格模式下，编译期报错 Property 'v' has no initializer
}

export let c = new C()

// app.ets
import { C, c } from './lib';

function foo(c: C) {
  c.v.length;
}

foo(c);
```
## 方舟运行时兼容TS/JS
API version 11上，OpenHarmony SDK中TypeScript版本为4.9.5，target字段为es2017。支持使用ECMA2017及更高版本语法开发TS/JS。
**应用环境限制**
1. 强制使用严格模式（use strict）
2. 禁止使用`eval()`
3. 禁止使用`with() {}`
4. 禁止以字符串为代码创建函数
5. 禁止循环依赖
循环依赖示例：
``` TypeScript
// bar.ets
import {v} from './foo'; // bar.ets依赖foo.ets
export let u = 0;
console.info(`v: ${v}`);
```
``` TypeScript
// foo.ets
import {u} from './bar'; // foo.ets同时又依赖bar.ets
export let v = 0;
console.info(`u: ${u}`);

// 应用加载失败
```
**与标准TS/JS的差异**
标准TS/JS中，JSON数字格式要求小数点后必须跟随数字，如 `2.e3` 不被允许，会导致`SyntaxError`。方舟运行时则支持此类科学计数法。
