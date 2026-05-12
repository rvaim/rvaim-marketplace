# 适配指导案例
本文通过具体应用场景案例，提供在ArkTS语法规则下将TS代码适配成ArkTS代码的建议。各章以ArkTS语法规则英文名称命名，每个案例展示适配前TS代码和适配后ArkTS代码。
## arkts-identifiers-as-prop-names
属性名是有效标识符时（不含特殊字符、空格，不以数字开头），可直接使用无需引号。
**应用代码**
``` TypeScript
interface W {
  bundleName: string
  action: string
  entities: string[]
}

let wantInfo: W = {
  'bundleName': 'com.huawei.hmos.browser',
  'action': 'ohos.want.action.viewData',
  'entities': ['entity.system.browsable']
}
```
**建议改法**
``` TypeScript
interface W {
  bundleName: string
  action: string
  entities: string[]
}

let wantInfo: W = {
  bundleName: 'com.huawei.hmos.browser',
  action: 'ohos.want.action.viewData',
  entities: ['entity.system.browsable']
}
```
## arkts-no-any-unknown
### 将`any, unknown`改为具体类型
``` TypeScript
function printObj(obj: any) {
  console.info(obj);
}

printObj('abc'); // abc
```
**建议改法**
``` TypeScript
function printObj(obj: string) {
  console.info(obj);
  // ...
}
// ...
          printObj('abc'); // abc
```
### 标注JSON.parse返回值类型
**应用代码**
``` TypeScript
class A {
  v: number = 0
  s: string = ''

  foo(str: string) {
    let tmpStr = JSON.parse(str);
    if (tmpStr.add != undefined) {
      this.v = tmpStr.v;
      this.s = tmpStr.s;
    }
  }
}
```
**建议改法**
``` TypeScript
class A {
  public v: number = 0
  public s: string = ''

  foo(str: string) {
    let tmpStr: Record<string, Object> = JSON.parse(str);
    if (tmpStr.add != undefined) {
      this.v = tmpStr.v as number;
      this.s = tmpStr.s as string;
    }
  }
}
```
### 使用Record类型
**应用代码**
``` TypeScript
function printProperties(obj: any) {
  console.info(obj.name);
  console.info(obj.value);
}
```
**建议改法**
``` TypeScript
function printProperties(obj: Record<string, Object>) {
  console.info(obj.name as string);
  console.info(obj.value as string);
  // ...
}
```
## arkts-no-call-signature
使用函数类型替代。
**应用代码**
``` TypeScript
interface I {
  (value: string): void;
}

function foo(fn: I) {
  fn('abc');
}

foo((value: string) => {
  console.info(value);
})
```
**建议改法**
``` TypeScript
type I = (value: string) => void

function foo(fn: I) {
  fn('abc');
}
// ...
  foo((value: string) => {
    console.info(value);
    // ...
  })
```
## arkts-no-ctor-signatures-type
使用工厂函数`() => Instance`替代构造函数签名。
**应用代码**
``` TypeScript
class Controller {
  value: string = ''

  constructor(value: string) { this.value = value; }
}

type ControllerConstructor = {
  new (value: string): Controller;
}

class testMenu {
  controller: ControllerConstructor = Controller
  createController() {
    if (this.controller) { return new this.controller('123'); }
    return null;
  }
}

let t = new testMenu();
console.info(t.createController()!.value);
```
**建议改法**
``` TypeScript
class Controller {
  public value: string = ''

  constructor(value: string) { this.value = value; }
}

type ControllerConstructor = () => Controller;

class TestMenu {
  public controller: ControllerConstructor = () => {
    return new Controller('abc');
  }

  createController() {
    if (this.controller) { return this.controller(); }
    return null;
  }
}
// ...
  let t: TestMenu = new TestMenu();
  console.info(t.createController()!.value);
```
## arkts-no-indexed-signatures
使用Record类型替代。
**应用代码**
``` TypeScript
function foo1(data: { [key: string]: string }) {
  data['a'] = 'a';
  data['b'] = 'b';
  data['c'] = 'c';
}
```
**建议改法**
``` TypeScript
function foo1(data: Record<string, string>) {
  data['a'] = 'a';
  data['b'] = 'b';
  data['c'] = 'c';
}
```
## arkts-no-typing-with-this
使用具体类型替代`this`。
**应用代码**
``` TypeScript
class C {
  getInstance(): this { return this; }
}
```
**建议改法**
``` TypeScript
class C {
  getInstance(): C { return this; }
}
```
## arkts-no-ctor-prop-decls
显式声明类属性，在构造函数中手动赋值。
**应用代码**
``` TypeScript
class Person {
  constructor(readonly name: string) {}

  getName(): string { return this.name; }
}
```
**建议改法**
``` TypeScript
class Person {
  public name: string
  constructor(name: string) { this.name = name; }

  getName(): string { return this.name; }
}
```
## arkts-no-ctor-signatures-iface
使用type定义工厂函数或普通函数类型。
**应用代码**
``` TypeScript
class Controller {
  value: string = ''

  constructor(value: string) { this.value = value; }
}

interface ControllerConstructor {
  new (value: string): Controller;
}

class testMenu {
  controller: ControllerConstructor = Controller
  createController() {
    if (this.controller) { return new this.controller('abc'); }
    return null;
  }
}

let t = new testMenu();
console.info(t.createController()!.value);
```
**建议改法**
``` TypeScript
class Controller {
  public value: string = ''

  constructor(value: string) { this.value = value; }
}

type ControllerConstructor = () => Controller;

class TestMenu {
  public controller: ControllerConstructor = () => {
    return new Controller('abc');
  }

  createController() {
    if (this.controller) { return this.controller(); }
    return null;
  }
}

let t: TestMenu = new TestMenu();
console.info(t.createController()!.value);
```
## arkts-no-props-by-index
将对象转换为Record类型以访问其属性。
**应用代码**
``` TypeScript
function foo2(params: Object) {
  let funNum: number = params['funNum'];
  let target: string = params['target'];
}
```
**建议改法**
``` TypeScript
function foo2(params: Record<string, string | number>) {
  let funNum: number = params['funNum'] as number;
  let target: string = params['target'] as string;
}
```
## arkts-no-inferred-generic-params
所有泛型调用应显式标注泛型参数类型，如 Map\<string, T\>、.map\<T\>()。
**应用代码**
``` TypeScript
class A {
  str: string = ''
}
class B extends A {}
class C extends A {}

let arr: Array<A> = [];

let originMenusMap:Map<string, C> = new Map(arr.map(item => [item.str, (item instanceof C) ? item: null]));
```
**建议改法**
``` TypeScript
class A {
  public str: string = ''
}
class B extends A {}
class C extends A {}

let arr: A[] = [];

let originMenusMap: Map<string, C | null> = new Map<string, C | null>
(arr.map<[string, C | null]>(item => [item.str, (item instanceof C) ? item: null]));
```
`(item instanceof C) ? item: null`需要声明类型为`C | null`，编译器无法推导`map`的泛型类型参数，需显式标注。
## arkts-no-regexp-literals
使用`new RegExp(pattern, flags)`构造函数替代RegExp字面量。
**应用代码**
``` TypeScript
let regex: RegExp = /\s*/g;
```
**建议改法**
``` TypeScript
let regexp: RegExp = new RegExp('\\s*','g');
```
如果正则表达式中使用了标志符，需要将其作为`new RegExp()`的参数。
## arkts-no-untyped-obj-literals
### 从SDK导入类型，标注object literal类型
**应用代码**
``` TypeScript
const area = { // 没有写明类型 不方便维护
  pixels: new ArrayBuffer(8),
  offset: 0,
  stride: 8,
  region: { size: { height: 1,width:2 }, x: 0, y: 0 }
}
```
**建议改法**
``` TypeScript
import { image } from '@kit.ImageKit';
// ...
const area: image.PositionArea = { // 写明具体类型
  pixels: new ArrayBuffer(8),
  offset: 0,
  stride: 8,
  region: { size: { height: 1, width: 2 }, x: 0, y: 0 }
}
```
### 用class标注类型，要求构造函数无参数
**应用代码**
``` TypeScript
class Test {
  value: number = 1
  // 有构造函数
  constructor(value: number) { this.value = value; }
}

let t: Test = { value: 2 };
```
**建议改法1** — 去除构造函数
``` TypeScript
// 去除构造函数
class Test {
  public value: number = 1
}

let t: Test = { value: 2 };
```
**建议改法2** — 使用new
``` TypeScript
// 使用new
class Test {
  public value: number = 1

  constructor(value: number) { this.value = value; }
}

let t: Test = new Test(2);
```
ArkTS禁止通过object literal绕过构造函数行为：
``` TypeScript
class C {
  value: number = 1

  constructor(n: number) {
    if (n < 0) { throw new Error('Negative'); }
    this.value = n;
  }
}

let s: C = new C(-2);   // 抛出异常
let t: C = { value: -2 }; // ArkTS不支持
```
### 用class/interface标注类型，要求使用identifier作为object literal的key
**应用代码**
``` TypeScript
class Test {
  value: number = 0
}

let arr: Test[] = [
  {
    'value': 1
  },
  {
    'value': 2
  },
  {
    'value': 3
  }
]
```
**建议改法**
``` TypeScript
class Test {
  public value: number = 0
}
let arr: Test[] = [
  {
    value: 1
  },
  {
    value: 2
  },
  {
    value: 3
  }
]
```
### 使用Record类型标注，要求使用字符串作为key
**应用代码**
``` TypeScript
let obj: Record<string, number | string> = {
  value: 123,
  name: 'abc'
}
```
**建议改法**
``` TypeScript
let obj: Record<string, number | string> = {
  'value': 123,
  'name': 'abc'
}
```
### 函数参数类型包含index signature
**应用代码**
``` TypeScript
function foo3(obj: { [key: string]: string}): string {
  if (obj != undefined && obj != null) { return obj.value1 + obj.value2; }
  return '';
}
```
**建议改法**
``` TypeScript
function foo(obj: Record<string, string>): string {
  if (obj != undefined && obj != null) { return obj.value1 + obj.value2; }
  return '';
}
```
### 函数实参使用object literal
**应用代码**
``` TypeScript
(fn) => {
  fn({ value: 123, name:'' });
}
```
**建议改法**
``` TypeScript
class T {
  public value: number = 0
  public name: string = ''
}

(fn: (v: T) => void) => {
  fn({ value: 123, name: '' });
}
```
### class/interface中包含方法
**应用代码**
``` TypeScript
interface T {
  foo(value: number): number
}

let t:T = { foo: (value) => { return value } };
```
**建议改法1** — 使用函数类型的属性
``` TypeScript
interface T {
  foo: (value: number) => number
}

let t:T = { foo: (value) => { return value } };
```
**建议改法2** — 使用class
``` TypeScript
class T {
  public foo: (value: number) => number = (value: number) => {
    return value;
  }
}

let t:T = new T();
```
class/interface中声明的方法应被所有实例共享，ArkTS不支持通过object literal改写实例方法。ArkTS支持函数类型的属性。
### export default对象
**应用代码**
``` TypeScript
export default {
  onCreate() {
    // ...
  },
  onDestroy() {
    // ...
  }
}
```
**建议改法**
``` TypeScript
class Test {
  onCreate() {
    // ...
  }
  onDestroy() {
    // ...
  }
}

export default new Test()
```
### 通过导入namespace获取类型
**应用代码** — test.d.ets
``` TypeScript
// test.d.ets
declare namespace test {
  interface I {
    id: string;
    type: number;
  }

  function foo(name: string, option: I): void;
}

export default test;
```
**应用代码** — app.ets
``` TypeScript
// app.ets
import test from './test';

let option = { id: '', type: 0 };
test.foo('', option);
```
**建议改法** — test.d.ets
``` TypeScript
// test.d.ets
declare namespace Test {
  interface I {
    id: string;
    type: number;
  }

  function foo(name: string, option: I): void;
  function foo(): I;
}

export default Test;
```
**建议改法** — app.ets
``` TypeScript
// app.ets
import test from './test';

let option = { id: '', type: 0 };
test.foo('', option);
```
对象字面量缺少类型，根据`test.foo`分析得知`option`的类型来源于声明文件，将类型导入即可。在ets文件中先导入namespace，再通过名称获取相应类型。
### object literal传参给Object类型
**应用代码**
``` TypeScript
function emit(event: string, ...args: Object[]): void {}

emit('', {
  'action': 11,
  'outers': false
});
```
**建议改法**
``` TypeScript
function emit(event: string, ...args: Object[]): void {}

let emitArg: Record<string, number | boolean> = {
  'action': 11,
  'outers': false
}

emit('', emitArg);
```
## arkts-no-obj-literals-as-types
使用interface显式定义结构类型。
**应用代码**
``` TypeScript
type Person = { name: string, age: number }
```
**建议改法**
``` TypeScript
interface Person {
  name: string,
  age: number
}
```
## arkts-no-noninferrable-arr-literals
显式声明数组元素类型（使用interface或class），并为数组变量添加类型注解。
**应用代码**
``` TypeScript
let permissionList = [
  { name: '设备信息', value: '用于分析设备的续航、通话、上网、SIM卡故障等' },
  { name: '麦克风', value: '用于反馈问题单时增加语音' },
  { name: '存储', value: '用于反馈问题单时增加本地文件附件' }
]
```
**建议改法**
``` TypeScript
class PermissionItem {
  public name?: string
  public value?: string
}

let permissionList: PermissionItem[] = [
  { name: '设备信息', value: '用于分析设备的续航、通话、上网、SIM卡故障等' },
  { name: '麦克风', value: '用于反馈问题单时增加语音' },
  { name: '存储', value: '用于反馈问题单时增加本地文件附件' }
]
```
## arkts-no-method-reassignment
使用函数类型的类字段代替原型方法。
**应用代码**
``` TypeScript
class C {
  add(left: number, right: number): number { return left + right; }
}

function sub(left: number, right: number): number { return left - right; }

let c1 = new C();
c1.add = sub;
```
**建议改法**
``` TypeScript
class C3 {
  public add: (left: number, right: number) => number =
    (left: number, right: number) => {
      return left + right;
    }
}

function sub(left: number, right: number): number { return left - right; }

let c1 = new C3();
c1.add = sub;
```
## arkts-no-polymorphic-unops
使用`Number.parseInt()`、`new Number()`等显式转换函数。
**应用代码**
``` TypeScript
let a = +'5'; // 使用操作符隐式转换
let b = -'5';
let c = ~'5';
let d = +'string';
```
**建议改法**
``` TypeScript
let a = Number.parseInt('5'); // 使用Number.parseInt显示转换
let b = -Number.parseInt('5');
let c = ~Number.parseInt('5');
let d = new Number('123');
```
## arkts-no-type-query
使用类、接口或类型别名替代typeof，避免依赖变量做类型推导。
**应用代码** — module1.ts
``` TypeScript
// module1.ts
class C {
  value: number = 0
}

export let c = new C()
```
**应用代码** — module2.ts
``` TypeScript
// module2.ts
import { c } from './module1'
let t: typeof c = { value: 123 };
```
**建议改法** — module1.ets
``` TypeScript
// 文件名：module1.ets
class C {
  public value: number = 0
}

export { C }
```
**建议改法** — module2.ets
``` TypeScript
// 文件名：module2.ets
import { C } from './module1'
let t: C = { value: 123 };
```
## arkts-no-in
使用`Object.keys`判断属性是否存在。
**应用代码**
``` TypeScript
function test(str: string, obj: Record<string, Object>) { return str in obj; }
```
**建议改法**
``` TypeScript
function test(str: string, obj: Record<string, Object>) {
  for (let i of Object.keys(obj)) {
    if (i == str) { return true; }
  }
  return false;
}
```
## arkts-no-destruct-assignment
使用索引访问元素或手动赋值代替解构赋值。
**应用代码**
``` TypeScript
let map = new Map<string, string>([['a', 'a'], ['b', 'b']]);
for (let [key, value] of map) {
  console.info(key);
  console.info(value);
}
```
**建议改法** — 使用数组
``` TypeScript
let map = new Map<string, string>([['a', 'a'], ['b', 'b']]);
// ...
for (let arr of map) {
  let key = arr[0];
  let value = arr[1];
  console.info(key);
  console.info(value);
  // ...
}
```
## arkts-no-types-in-catch
使用无类型`catch (error)`，然后通过类型断言处理。
**应用代码**
```typescript
import { BusinessError } from '@kit.BasicServicesKit'

try {
  // ...
} catch (e: BusinessError) {
  console.error(e.message, e.code);
}
```
**建议改法**
``` TypeScript
import { BusinessError } from '@kit.BasicServicesKit'
// ...
try {
  // ...
} catch (error) {
  let e: BusinessError = error as BusinessError;
  console.error(e.message, e.code);
}
```
## arkts-no-for-in
使用`Object.entries(obj) + for of`替代`for in`。
**应用代码**
``` TypeScript
interface Person {
  [name: string]: string
}
let p: Person = {
  name: 'tom',
  age: '18'
};

for (let t in p) {
  console.info(p[t]);  // info: "tom", "18"
}
```
**建议改法**
``` TypeScript
let p: Record<string, string> = {
  'name': 'tom',
  'age': '18'
};
// ...
for (let ele of Object.entries(p)) {
  console.info(ele[1]); // info: "tom", "18"
  // ...
}
```
## arkts-no-mapped-types
使用`Record<K, T>`替代映射类型。
**应用代码**
``` TypeScript
class C {
  a: number = 0
  b: number = 0
  c: number = 0
}
type OptionsFlags = {
  [Property in keyof C]: string
}
```
**建议改法**
``` TypeScript
class C {
  public a: number = 0
  public b: number = 0
  public c: number = 0
}

type OptionsFlags = Record<keyof C, string>
```
## arkts-limited-throw
将对象转换为Error，或创建新的Error实例抛出。
**应用代码**
``` TypeScript
import { BusinessError } from '@kit.BasicServicesKit'

function ThrowError(error: BusinessError) { throw error; }
```
**建议改法**
``` TypeScript
import { BusinessError } from '@kit.BasicServicesKit'

function throwError(error: BusinessError) { throw error as Error; }
```
`throw`语句中值的类型必须为`Error`或其继承类，如继承类是泛型会有编译期报错。建议使用`as`将类型转换为`Error`。
## arkts-no-standalone-this
### 函数内使用this
**应用代码**
``` TypeScript
function foo4() {
  console.info(this.value);
}

let obj = { value: 'abc' };
foo.apply(obj);
```
**建议改法1** — 使用类的方法实现，如需被多个类使用可考虑继承
``` TypeScript
class Test {
  public value: string = ''
  constructor (value: string) {
    this.value = value
  }

  foo() {
    console.info(this.value);
    // ...
  }
}

let obj: Test = new Test('abc');
obj.foo();
```
**建议改法2** — 将this作为参数传入
``` TypeScript
function foo3(obj: Test) {
  console.info(obj.value);
  // ...
}
// ...
class Test {
  public value: string = ''
}
let obj1: Test = { value: 'abc' };
foo3(obj1);
```
**建议改法3** — 将属性作为参数传入
``` TypeScript
function foo5(value: string) {
  console.info(value);
}

class Test1 {
  value: string = ''
}

let obj2: Test1 = { value: 'abc' };
foo5(obj2.value);
```
### class的静态方法内使用this
**应用代码**
``` TypeScript
class Test {
  static value: number = 123
  static foo(): number { return this.value }
}
```
**建议改法**
``` TypeScript
class Test {
  public static value: number = 123
  public static foo(): number { return Test.value }
}
```
## arkts-no-spread
使用`Object.assign()`、手动赋值或数组方法替代扩展运算符。
**应用代码** — test.d.ets
```typescript
// test.d.ets
declare namespace test {
  interface I {
    id: string;
    type: number;
  }

  function foo(): I;
}

export default test

// app.ets
import test from 'test';

let t: test.I = {
  ...test.foo(),
  type: 0
}
```
**建议改法** — test.d.ets
``` TypeScript
// test.d.ets
declare namespace Test {
  interface I {
    id: string;
    type: number;
  }

  function foo(name: string, option: I): void;
  function foo(): I;
}

export default Test;
```
**建议改法** — app.ets
``` TypeScript
// app.ets
import test from './test';

let t: test.I = test.foo();
t.type = 0;
```
ArkTS中对象布局在编译期确定。如需将一个对象的所有属性展开赋值给另一个对象，可通过逐个属性赋值完成。本例中展开对象和赋值目标对象类型相同，可通过改变该对象属性的方式重构。
## arkts-no-ctor-signatures-funcs
在class内声明属性，而非在构造函数上。
**应用代码**
``` TypeScript
class Controller {
  value: string = ''
  constructor(value: string) {
    this.value = value
  }
}

type ControllerConstructor = new (value: string) => Controller;

class testMenu {
  controller: ControllerConstructor = Controller
  createController() {
    if (this.controller) { return new this.controller('abc'); }
    return null;
  }
}

let t = new testMenu()
console.info(t.createController()!.value)
```
**建议改法**
``` TypeScript
class Controller {
  public value: string = ''
  constructor(value: string) { this.value = value; }
}

type ControllerConstructor = () => Controller;

class TestMenu {
  public controller: ControllerConstructor = () => { return new Controller('abc') }
  createController() {
    if (this.controller) { return this.controller(); }
    return null;
  }
}

let t: TestMenu = new TestMenu();
console.info(t.createController()!.value);
```
## arkts-no-globalthis
ArkTS不支持`globalThis`。无法为`globalThis`添加静态类型，只能通过查找方式访问其属性，导致额外性能开销。
> **说明：**
>
> 1. 建议按照业务逻辑根据`import/export`语法实现数据在不同模块的传递。
> 2. 必要情况下，可通过构造的单例对象实现全局对象功能。（不能在har中定义单例对象，har在打包时会在不同的hap中打包两份，无法实现单例。）
**构造单例对象**
``` TypeScript
// 构造单例对象
export class GlobalContext {
  private constructor() {}
  private static instance: GlobalContext;
  private _objects = new Map<string, Object>();

  public static getContext(): GlobalContext {
    if (!GlobalContext.instance) {
      GlobalContext.instance = new GlobalContext();
    }
    return GlobalContext.instance;
  }

  getObject(value: string): Object | undefined { return this._objects.get(value); }

  setObject(key: string, objectClass: Object): void { this._objects.set(key, objectClass); }
}
```
**应用代码** — file1.ts
``` TypeScript
// file1.ts

export class Test {
  value: string = '';
  foo(): void {
    globalThis.value = this.value;
  }
}
```
**应用代码** — file2.ts
``` TypeScript
// file2.ts

globalThis.value;
```
**建议改法** — file1.ets
``` TypeScript
// file1.ets

import { GlobalContext } from './GlobalContext'

export class Test {
  public value: string = '';
  foo(): void {
    GlobalContext.getContext().setObject('value', this.value);
  }
}
```
**建议改法** — file2.ets
``` TypeScript
// file2.ets

import { GlobalContext } from './GlobalContext'

GlobalContext.getContext().getObject('value');
```
## arkts-no-func-apply-bind-call
### 使用标准库中接口
**应用代码**
``` TypeScript
let arr: number[] = [1, 2, 3, 4];
let str = String.fromCharCode.apply(null, Array.from(arr));
```
**建议改法**
``` TypeScript
let arr: number[] = [1, 2, 3, 4];
let str = String.fromCharCode(...Array.from(arr));
```
### bind定义方法
**应用代码**
``` TypeScript
class A {
  value: string = ''
  foo: Function = () => {}
}

class Test {
  value: string = '1234'
  obj: A = {
    value: this.value,
    foo: this.foo.bind(this)
  }

  foo() {
    console.info(this.value);
  }
}
```
**建议改法1**
``` TypeScript
class A {
  public value: string = ''
  public foo: Function = () => {}
}

class Test {
  public value: string = '1234'
  public obj: A = {
    value: this.value,
    foo: (): void => this.foo()
  }

  foo() {
    console.info(this.value);
  }
}
```
**建议改法2**
``` TypeScript
class A {
  public value: string = ''
  public foo: Function = () => {}
}

class Test {
  public value: string = '1234'
  public foo: () => void = () => {
    console.info(this.value);
  }
  public obj: A = {
    value: this.value,
    foo: this.foo
  }
}
```
### 使用apply
**应用代码**
``` TypeScript
class A {
  value: string;
  constructor (value: string) { this.value = value; }

  foo() {
    console.info(this.value);
  }
}

let a1 = new A('1');
let a2 = new A('2');

a1.foo();
a1.foo.apply(a2);
```
**建议改法**
``` TypeScript
class A {
  public value: string;
  constructor (value: string) { this.value = value; }

  foo() { this.fooApply(this); }

  fooApply(a: A) {
    console.info(a.value);
    // ...
  }
}

let a1 = new A('1');
let a2 = new A('2');

a1.foo();
a1.fooApply(a2);
```
## arkts-limited-stdlib
### `Object.fromEntries()`
**应用代码**
``` TypeScript
let entries = new Map([
  ['foo', 123],
  ['bar', 456]
]);

let obj = Object.fromEntries(entries);
```
**建议改法**
``` TypeScript
let entries = new Map([
  ['foo', 123],
  ['bar', 456]
]);

let obj: Record<string, Object> = {};
entries.forEach((value, key) => {
  if (key != undefined && key != null) {
    obj[key] = value;
  }
})
```
## 严格模式检查 (StrictModeError)
### strictPropertyInitialization
**应用代码**
``` TypeScript
interface I {
  name:string
}

class A {}

class Test {
  a: number;
  b: string;
  c: boolean;
  d: I;
  e: A;
}
```
**建议改法**
``` TypeScript
{
  interface I {
    name:string
  }

  class A {}

  class Test {
    public a: number;
    public b: string;
    public c: boolean;
    public d: I = { name:'abc' };
    public e: A | null = null;
    constructor(a:number, b:string, c:boolean) {
      this.a = a;
      this.b = b;
      this.c = c;
    }
  }
}
```
### Type `*** | null` is not assignable to type `***`
**应用代码**
``` TypeScript
class A {
  bar() {}
}
function foo(n: number) {
  if (n === 0) { return null; }
  return new A();
}
function getNumber() { return 5; }
let a:A = foo(getNumber());
a.bar();
```
**建议改法**
``` TypeScript
class A {
  bar() {}
}
function foo(n: number) {
  if (n === 0) { return null; }
  return new A();
}
function getNumber() { return 5; }

let a: A | null = foo(getNumber());
a?.bar();
```
### 严格属性初始化检查
class中属性未初始化且未在构造函数中赋值，ArkTS将报错。
**建议改法**
1. 在声明时初始化属性，或在构造函数中赋值：
```typescript
// code with error
class Test {
  value: number
  flag: boolean
}

// 方式一，在声明时初始化
class Test {
  value: number = 0
  flag: boolean = false
}

// 方式二，在构造函数中赋值
class Test {
  value: number
  flag: boolean
  constructor(value: number, flag: boolean) {
    this.value = value;
    this.flag = flag;
  }
}
```
2. 对象类型（包括函数类型）`A`不确定如何初始化时：
​ 方式(i)  `prop: A | null = null`
​ 方式(ii) `prop?: A`
​ 方式(iii) `prop: A | undefined = undefined`
- 性能角度：`null`类型仅用于编译期类型检查，不影响虚拟机性能；`undefined | A`视为联合类型，运行时可能产生额外开销。
- 可读性角度：`prop?:A`是`prop: A | undefined = undefined`的语法糖，推荐使用可选属性写法。
### 严格函数类型检查
**应用代码**
```typescript
function foo(fn: (value?: string) => void, value: string): void {}

foo((value: string) => {}, ''); // error
```
**建议改法**
``` TypeScript
function foo1(fn: (value?: string) => void, value: string): void {}

foo1((value?: string) => {}, '');
```
不开启严格函数类型检查时，以下代码可编译通过但运行时会产生非预期行为：
```typescript
function foo(fn: (value?: string) => void, value: string): void {
  let v: string | undefined = undefined;
  fn(v);
}

foo((value: string) => { console.info(value.toUpperCase()) }, ''); // Cannot read properties of undefined (reading 'toUpperCase')
```
开启严格类型检查后，此代码无法编译通过。
### 严格空值检查
**应用代码**
``` TypeScript
class Test {
  private value?: string;

  public printValue () {
    console.info(this.value.toLowerCase());
  }
}

let t = new Test();
t.printValue();
```
由于`value`为`undefined`且`printValue`方法内未进行空值检查，运行时报错。
**建议改法** — 使用可空类型前需进行空值判断
``` TypeScript
class Test {
  private value?: string;

  public printValue () {
    if (this.value) {
      console.info(this.value.toLowerCase());
    }
  }
}

let t = new Test();
t.printValue();
```
### 函数返回类型不匹配
**应用代码**
``` TypeScript
class Test {
  handleClick: (action: string, externInfo?: string) => void | null = null;
}
```
函数返回类型被解析为`void | undefined`，需添加括号区分union类型：
``` TypeScript
class Test {
  public handleClick: ((action: string, externInfo?: string) => void) | null = null;
}
```
### Type '*** | null' is not assignable to type '***'
**应用代码**
``` TypeScript
class A {
  value: number
  constructor(value: number) { this.value = value; }
}

function foo6(v: number): A | null {
  if (v > 0) { return new A(v); }
  return null;
}

let a1: A = foo6(1);
```
**建议改法1** — 修改变量类型：`let a: A | null = foo()`
``` TypeScript
class A1 {
  value: number
  constructor(value: number) { this.value = value; }
}

function foo(v: number): A1 | null {
  if (v > 0) { return new A1(v); }
  return null;
}

let a: A1 | null = foo(123);

if (a != null) {
  // 非空分支
} else {
  // 处理null
}
```
**建议改法2** — 确定此处调用一定返回非空值时使用非空断言`!`
``` TypeScript
class A2 {
  value: number
  constructor(value: number) { this.value = value; }
}

function foo(v: number): A2 | null {
  if (v > 0) { return new A2(v); }
  return null;
}

let a: A2 = foo(123)!;
```
### Cannot invoke an object which is possibly 'undefined'
**应用代码**
``` TypeScript
interface A {
  foo?: () => void
}

let a:A = { foo: () => {} };
a.foo();
```
**建议改法1** — 将foo设为必选属性
``` TypeScript
interface A {
  foo: () => void
}
let a: A = { foo: () => {} };
a.foo();
```
**建议改法2** — 访问前进行空值检查
``` TypeScript
interface A {
  foo?: () => void
}

let a: A = { foo: () => {} };
if (a.foo) {
  a.foo();
}
```
### Variable '***' is used before being assigned
**应用代码**
``` TypeScript
class Test {
  value: number = 0
}

let a: Test
try {
  a = { value: 1};
} catch (e) {
  a.value;
}
a.value;
```
**建议改法**
``` TypeScript
class Test {
  public value: number = 0
}

let a: Test | null = null;
try {
  a = { value:1 };
} catch (e) {
  if (a) {
    a.value;
  }
}

if (a) {
  a.value;
}
```
对于原始类型，可按业务逻辑赋值（如0、''、false）。对于对象类型，类型改为与null的联合类型并赋值为null，使用时需非空检查。
### Function lacks ending return statement and return type does not include 'undefined'
**应用代码**
``` TypeScript
function foo7(a: number): number {
  if (a > 0) { return a; }
}
```
**建议改法1** — 根据业务逻辑在else分支中返回合适的数值。
**建议改法2**
``` TypeScript
function foo4(a: number): number | undefined {
  if (a > 0) { return a; }
  return
}
```
## arkts-strict-typing-required
删除忽略注释，为所有变量显式声明类型。
**应用代码**
``` TypeScript
// @ts-ignore
var a: any = 123;
```
**建议改法**
``` TypeScript
let a: number = 123;
```
ArkTS不支持通过注释绕过严格类型检查。先删除`// @ts-nocheck`或`// @ts-ignore`注释，再根据报错信息修改代码。
## Importing ArkTS files to JS and TS files is not allowed
## arkts-no-tsdeps
不允许.ts、.js文件`import`.ets文件源码。
**建议改法**
方式1：将.ts文件后缀修改为ets，并按ArkTS语法规则适配代码。
方式2：将.ets文件中被.ts文件依赖的代码单独抽取到.ts文件中。
## arkts-no-special-imports
改为使用普通`import { ... } from '...'`导入类型。
**应用代码**
```typescript
import type {A, B, C, D } from '***'
```
**建议改法**
```typescript
import {A, B, C, D } from '***'
```
## arkts-no-classes-as-obj
### 使用class构造实例
**应用代码**
``` TypeScript
class Controller {
  value: string = ''
  constructor(value: string) {
    this.value = value
  }
}

interface ControllerConstructor {
  new (value: string): Controller;
}

class TestMenu {
  controller: ControllerConstructor = Controller
  createController() {
    if (this.controller) { return new this.controller('abc'); }
    return null;
  }
}

let t = new TestMenu();
console.info(t.createController()!.value);
```
**建议改法**
``` TypeScript
class Controller {
  public value: string = ''

  constructor(value: string) { this.value = value; }
}

type ControllerConstructor = () => Controller;

class TestMenu {
  public controller: ControllerConstructor = () => {
    return new Controller('abc');
  }

  createController() {
    if (this.controller) { return this.controller(); }
    return null;
  }
}

let t: TestMenu = new TestMenu();
console.info(t.createController()!.value);
```
### 访问静态属性
**应用代码**
``` TypeScript
class C1 {
  static value: string = 'abc'
}

class C2 {
  static value: string = 'def'
}

function getValue(obj: any) { return obj['value']; }

console.info(getValue(C1));
console.info(getValue(C2));
```
**建议改法**
``` TypeScript
class C1 {
  public static value: string = 'abc'
}

class C2 {
  public static value: string = 'def'
}

function getC1Value(): string { return C1.value; }

function getC2Value(): string { return C2.value; }

console.info(getC1Value());
console.info(getC2Value());
```
## arkts-no-side-effects-imports
改用动态import。
**应用代码**
``` TypeScript
import 'module'
```
**建议改法**
```typescript
import('module')
```
## arkts-no-func-props
使用class来组织多个相关函数。
**应用代码**
``` TypeScript
function foo8(value: number): void {
  console.info(value.toString());
}

foo8.add = (left: number, right: number) => {
  return left + right;
}

foo8.sub = (left: number, right: number) => {
  return left - right;
}
```
**建议改法**
``` TypeScript
class Foo {
  static foo(value: number): void {
    console.info(value.toString());
    // ...
  }

  static add(left: number, right: number): number { return left + right; }

  static sub(left: number, right: number): number { return left - right; }
}
```
## arkts-limited-esobj
使用具体类型（如number, string）或接口代替不明确的ESObject。
**应用代码** — testa.ts
``` TypeScript
// testa.ts
export function foo(): any { return null; }
```
**应用代码** — main.ets
``` TypeScript
// main.ets
import {foo} from './testa'
let e0: ESObject = foo();

function f() {
  let e1 = foo();
  let e2: ESObject = 1;
  let e3: ESObject = {};
  let e4: ESObject = '';
}
```
**建议改法** — testa.ts
``` TypeScript
// testa.ts
export function foo(): any { return null; }
```
**建议改法** — main.ets
``` TypeScript
// main.ets
import {foo} from './testa'
interface I {}

function f() {
  let e0: ESObject = foo();
  let e1: ESObject = foo();
  let e2: number = 1;
  let e3: I = {};
  let e4: string = '';
}
```
## 拷贝
### 浅拷贝
**TypeScript**
``` TypeScript
function shallowCopy(obj: object): object {
  let newObj = {};
  Object.assign(newObj, obj);
  return newObj;
}
```
**ArkTS**
``` TypeScript
function shallowCopy(obj: object): object {
  let newObj: Record<string, Object> = {};
  for (let key of Object.keys(obj)) {
    newObj[key] = obj[key];
  }
  return newObj;
}
```
### 深拷贝
**TypeScript**
``` TypeScript
function deepCopy(obj: object): object {
  let newObj = Array.isArray(obj) ? [] : {};
  for (let key in obj) {
    if (typeof obj[key] === 'object') {
      newObj[key] = deepCopy(obj[key]);
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}
```
**ArkTS**
``` TypeScript
function deepCopy(obj: object): object {
  let newObj: Record<string, Object> | Object[] = Array.isArray(obj) ? [] : {};
  for (let key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      newObj[key] = deepCopy(obj[key]);
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}
```
