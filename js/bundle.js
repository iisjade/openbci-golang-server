(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var glslify = require("glslify");
var createShader = require("gl-shader");
var compositeShader = require("glslify/simple-adapter.js")("\n#define GLSLIFY 1\n\nattribute vec2 position;\nvarying vec2 uv;\nvoid main() {\n  uv = position;\n  gl_Position = vec4(position, 0, 1);\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform sampler2D accumBuffer;\nvarying vec2 uv;\nvoid main() {\n  vec4 accum = texture2D(accumBuffer, 0.5 * (uv + 1.0));\n  gl_FragColor = min(vec4(1, 1, 1, 1), accum);\n}", [{"name":"accumBuffer","type":"sampler2D"}], [{"name":"position","type":"vec2"}]);

module.exports = function(gl) {
    return createShader(gl, compositeShader);
};
},{"gl-shader":136,"glslify":164,"glslify/simple-adapter.js":170}],2:[function(require,module,exports){
"use strict"

var pool = require("typedarray-pool")
var ops = require("ndarray-ops")
var ndarray = require("ndarray")
var webglew = require("webglew")

var SUPPORTED_TYPES = [
  "uint8",
  "uint8_clamped",
  "uint16",
  "uint32",
  "int8",
  "int16",
  "int32",
  "float32" ]

function GLBuffer(gl, type, handle, length, usage) {
  this.gl = gl
  this.type = type
  this.handle = handle
  this.length = length
  this.usage = usage
}

var proto = GLBuffer.prototype

proto.bind = function() {
  this.gl.bindBuffer(this.type, this.handle)
}

proto.unbind = function() {
  this.gl.bindBuffer(this.type, null)
}

proto.dispose = function() {
  this.gl.deleteBuffer(this.handle)
}

function updateTypeArray(gl, type, len, usage, data, offset) {
  var dataLen = data.length * data.BYTES_PER_ELEMENT 
  if(offset < 0) {
    gl.bufferData(type, data, usage)
    return dataLen
  }
  if(dataLen + offset > len) {
    throw new Error("gl-buffer: If resizing buffer, must not specify offset")
  }
  gl.bufferSubData(type, offset, data)
  return len
}

function makeScratchTypeArray(array, dtype) {
  var res = pool.malloc(array.length, dtype)
  var n = array.length
  for(var i=0; i<n; ++i) {
    res[i] = array[i]
  }
  return res
}

function isPacked(shape, stride) {
  var n = 1
  for(var i=stride.length-1; i>=0; --i) {
    if(stride[i] !== n) {
      return false
    }
    n *= shape[i]
  }
  return true
}

proto.update = function(array, offset) {
  if(typeof offset !== "number") {
    offset = -1
  }
  this.bind()
  if(typeof array === "object" && typeof array.shape !== "undefined") { //ndarray
    var dtype = array.dtype
    if(SUPPORTED_TYPES.indexOf(dtype) < 0) {
      dtype = "float32"
    }
    if(this.type === this.gl.ELEMENT_ARRAY_BUFFER) {
      var wgl = webglew(this.gl)
      var ext = wgl.OES_element_index_uint
      if(ext && dtype !== "uint16") {
        dtype = "uint32"
      } else {
        dtype = "uint16"
      }
    }
    if(dtype === array.dtype && isPacked(array.shape, array.stride)) {
      if(array.offset === 0 && array.data.length === array.shape[0]) {
        this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, array.data, offset)
      } else {
        this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, array.data.subarray(array.offset, array.shape[0]), offset)
      }
    } else {
      var tmp = pool.malloc(array.size, dtype)
      var ndt = ndarray(tmp, array.shape)
      ops.assign(ndt, array)
      if(offset < 0) {
        this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, tmp, offset)  
      } else {
        this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, tmp.subarray(0, array.size), offset)  
      }
      pool.free(tmp)
    }
  } else if(Array.isArray(array)) { //Vanilla array
    var t
    if(this.type === this.gl.ELEMENT_ARRAY_BUFFER) {
      t = makeScratchTypeArray(array, "uint16")
    } else {
      t = makeScratchTypeArray(array, "float32")
    }
    if(offset < 0) {
      this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, t, offset)
    } else {
      this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, t.subarray(0, array.length), offset)
    }
    pool.free(t)
  } else if(typeof array === "object" && typeof array.length === "number") { //Typed array
    this.length = updateTypeArray(this.gl, this.type, this.length, this.usage, array, offset)
  } else if(typeof array === "number" || array === undefined) { //Number/default
    if(offset >= 0) {
      throw new Error("gl-buffer: Cannot specify offset when resizing buffer")
    }
    array = array | 0
    if(array <= 0) {
      array = 1
    }
    this.gl.bufferData(this.type, array|0, this.usage)
    this.length = array
  } else { //Error, case should not happen
    throw new Error("gl-buffer: Invalid data type")
  }
}

function createBuffer(gl, data, type, usage) {
  webglew(gl)
  type = type || gl.ARRAY_BUFFER
  usage = usage || gl.DYNAMIC_DRAW
  if(type !== gl.ARRAY_BUFFER && type !== gl.ELEMENT_ARRAY_BUFFER) {
    throw new Error("gl-buffer: Invalid type for webgl buffer, must be either gl.ARRAY_BUFFER or gl.ELEMENT_ARRAY_BUFFER")
  }
  if(usage !== gl.DYNAMIC_DRAW && usage !== gl.STATIC_DRAW && usage !== gl.STREAM_DRAW) {
    throw new Error("gl-buffer: Invalid usage for buffer, must be either gl.DYNAMIC_DRAW, gl.STATIC_DRAW or gl.STREAM_DRAW")
  }
  var handle = gl.createBuffer()
  var result = new GLBuffer(gl, type, handle, 0, usage)
  result.update(data)
  return result
}

module.exports = createBuffer
},{"ndarray":247,"ndarray-ops":3,"typedarray-pool":10,"webglew":12}],3:[function(require,module,exports){
"use strict"

var compile = require("cwise-compiler")

var EmptyProc = {
  body: "",
  args: [],
  thisVars: [],
  localVars: []
}

function fixup(x) {
  if(!x) {
    return EmptyProc
  }
  for(var i=0; i<x.args.length; ++i) {
    var a = x.args[i]
    if(i === 0) {
      x.args[i] = {name: a, lvalue:true, rvalue: !!x.rvalue, count:x.count||1 }
    } else {
      x.args[i] = {name: a, lvalue:false, rvalue:true, count: 1}
    }
  }
  if(!x.thisVars) {
    x.thisVars = []
  }
  if(!x.localVars) {
    x.localVars = []
  }
  return x
}

function pcompile(user_args) {
  return compile({
    args:     user_args.args,
    pre:      fixup(user_args.pre),
    body:     fixup(user_args.body),
    post:     fixup(user_args.proc),
    funcName: user_args.funcName
  })
}

function makeOp(user_args) {
  var args = []
  for(var i=0; i<user_args.args.length; ++i) {
    args.push("a"+i)
  }
  var wrapper = new Function("P", [
    "return function ", user_args.funcName, "_ndarrayops(", args.join(","), ") {P(", args.join(","), ");return a0}"
  ].join(""))
  return wrapper(pcompile(user_args))
}

var assign_ops = {
  add:  "+",
  sub:  "-",
  mul:  "*",
  div:  "/",
  mod:  "%",
  band: "&",
  bor:  "|",
  bxor: "^",
  lshift: "<<",
  rshift: ">>",
  rrshift: ">>>"
}
;(function(){
  for(var id in assign_ops) {
    var op = assign_ops[id]
    exports[id] = makeOp({
      args: ["array","array","array"],
      body: {args:["a","b","c"],
             body: "a=b"+op+"c"},
      funcName: id
    })
    exports[id+"eq"] = makeOp({
      args: ["array","array"],
      body: {args:["a","b"],
             body:"a"+op+"=b"},
      rvalue: true,
      funcName: id+"eq"
    })
    exports[id+"s"] = makeOp({
      args: ["array", "array", "scalar"],
      body: {args:["a","b","s"],
             body:"a=b"+op+"s"},
      funcName: id+"s"
    })
    exports[id+"seq"] = makeOp({
      args: ["array","scalar"],
      body: {args:["a","s"],
             body:"a"+op+"=s"},
      rvalue: true,
      funcName: id+"seq"
    })
  }
})();

var unary_ops = {
  not: "!",
  bnot: "~",
  neg: "-",
  recip: "1.0/"
}
;(function(){
  for(var id in unary_ops) {
    var op = unary_ops[id]
    exports[id] = makeOp({
      args: ["array", "array"],
      body: {args:["a","b"],
             body:"a="+op+"b"},
      funcName: id
    })
    exports[id+"eq"] = makeOp({
      args: ["array"],
      body: {args:["a"],
             body:"a="+op+"a"},
      rvalue: true,
      count: 2,
      funcName: id+"eq"
    })
  }
})();

var binary_ops = {
  and: "&&",
  or: "||",
  eq: "===",
  neq: "!==",
  lt: "<",
  gt: ">",
  leq: "<=",
  geq: ">="
}
;(function() {
  for(var id in binary_ops) {
    var op = binary_ops[id]
    exports[id] = makeOp({
      args: ["array","array","array"],
      body: {args:["a", "b", "c"],
             body:"a=b"+op+"c"},
      funcName: id
    })
    exports[id+"s"] = makeOp({
      args: ["array","array","scalar"],
      body: {args:["a", "b", "s"],
             body:"a=b"+op+"s"},
      funcName: id+"s"
    })
    exports[id+"eq"] = makeOp({
      args: ["array", "array"],
      body: {args:["a", "b"],
             body:"a=a"+op+"b"},
      rvalue:true,
      count:2,
      funcName: id+"eq"
    })
    exports[id+"seq"] = makeOp({
      args: ["array", "scalar"],
      body: {args:["a","s"],
             body:"a=a"+op+"s"},
      rvalue:true,
      count:2,
      funcName: id+"seq"
    })
  }
})();

var math_unary = [
  "abs",
  "acos",
  "asin",
  "atan",
  "ceil",
  "cos",
  "exp",
  "floor",
  "log",
  "round",
  "sin",
  "sqrt",
  "tan"
]
;(function() {
  for(var i=0; i<math_unary.length; ++i) {
    var f = math_unary[i]
    exports[f] = makeOp({
                    args: ["array", "array"],
                    pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                    body: {args:["a","b"], body:"a=this_f(b)", thisVars:["this_f"]},
                    funcName: f
                  })
    exports[f+"eq"] = makeOp({
                      args: ["array"],
                      pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                      body: {args: ["a"], body:"a=this_f(a)", thisVars:["this_f"]},
                      rvalue: true,
                      count: 2,
                      funcName: f+"eq"
                    })
  }
})();

var math_comm = [
  "max",
  "min",
  "atan2",
  "pow"
]
;(function(){
  for(var i=0; i<math_comm.length; ++i) {
    var f= math_comm[i]
    exports[f] = makeOp({
                  args:["array", "array", "array"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b","c"], body:"a=this_f(b,c)", thisVars:["this_f"]},
                  funcName: f
                })
    exports[f+"s"] = makeOp({
                  args:["array", "array", "scalar"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b","c"], body:"a=this_f(b,c)", thisVars:["this_f"]},
                  funcName: f+"s"
                  })
    exports[f+"eq"] = makeOp({ args:["array", "array"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b"], body:"a=this_f(a,b)", thisVars:["this_f"]},
                  rvalue: true,
                  count: 2,
                  funcName: f+"eq"
                  })
    exports[f+"seq"] = makeOp({ args:["array", "scalar"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b"], body:"a=this_f(a,b)", thisVars:["this_f"]},
                  rvalue:true,
                  count:2,
                  funcName: f+"seq"
                  })
  }
})();

var math_noncomm = [
  "atan2",
  "pow"
]
;(function(){
  for(var i=0; i<math_noncomm.length; ++i) {
    var f= math_noncomm[i]
    exports[f+"op"] = makeOp({
                  args:["array", "array", "array"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b","c"], body:"a=this_f(c,b)", thisVars:["this_f"]},
                  funcName: f+"op"
                })
    exports[f+"ops"] = makeOp({
                  args:["array", "array", "scalar"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b","c"], body:"a=this_f(c,b)", thisVars:["this_f"]},
                  funcName: f+"ops"
                  })
    exports[f+"opeq"] = makeOp({ args:["array", "array"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b"], body:"a=this_f(b,a)", thisVars:["this_f"]},
                  rvalue: true,
                  count: 2,
                  funcName: f+"opeq"
                  })
    exports[f+"opseq"] = makeOp({ args:["array", "scalar"],
                  pre: {args:[], body:"this_f=Math."+f, thisVars:["this_f"]},
                  body: {args:["a","b"], body:"a=this_f(b,a)", thisVars:["this_f"]},
                  rvalue:true,
                  count:2,
                  funcName: f+"opseq"
                  })
  }
})();

exports.any = compile({
  args:["array"],
  pre: EmptyProc,
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:1}], body: "if(a){return true}", localVars: [], thisVars: []},
  post: {args:[], localVars:[], thisVars:[], body:"return false"},
  funcName: "any"
})

exports.all = compile({
  args:["array"],
  pre: EmptyProc,
  body: {args:[{name:"x", lvalue:false, rvalue:true, count:1}], body: "if(!x){return false}", localVars: [], thisVars: []},
  post: {args:[], localVars:[], thisVars:[], body:"return true"},
  funcName: "all"
})

exports.sum = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=0"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:1}], body: "this_s+=a", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return this_s"},
  funcName: "sum"
})

exports.prod = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=1"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:1}], body: "this_s*=a", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return this_s"},
  funcName: "prod"
})

exports.norm2squared = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=0"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:2}], body: "this_s+=a*a", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return this_s"},
  funcName: "norm2squared"
})
  
exports.norm2 = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=0"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:2}], body: "this_s+=a*a", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return Math.sqrt(this_s)"},
  funcName: "norm2"
})
  

exports.norminf = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=0"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:4}], body:"if(-a>this_s){this_s=-a}else if(a>this_s){this_s=a}", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return this_s"},
  funcName: "norminf"
})

exports.norm1 = compile({
  args:["array"],
  pre: {args:[], localVars:[], thisVars:["this_s"], body:"this_s=0"},
  body: {args:[{name:"a", lvalue:false, rvalue:true, count:3}], body: "this_s+=a<0?-a:a", localVars: [], thisVars: ["this_s"]},
  post: {args:[], localVars:[], thisVars:["this_s"], body:"return this_s"},
  funcName: "norm1"
})

exports.sup = compile({
  args: [ "array" ],
  pre:
   { body: "this_h=-Infinity",
     args: [],
     thisVars: [ "this_h" ],
     localVars: [] },
  body:
   { body: "if(_inline_1_arg0_>this_h)this_h=_inline_1_arg0_",
     args: [{"name":"_inline_1_arg0_","lvalue":false,"rvalue":true,"count":2} ],
     thisVars: [ "this_h" ],
     localVars: [] },
  post:
   { body: "return this_h",
     args: [],
     thisVars: [ "this_h" ],
     localVars: [] }
 })

exports.inf = compile({
  args: [ "array" ],
  pre:
   { body: "this_h=Infinity",
     args: [],
     thisVars: [ "this_h" ],
     localVars: [] },
  body:
   { body: "if(_inline_1_arg0_<this_h)this_h=_inline_1_arg0_",
     args: [{"name":"_inline_1_arg0_","lvalue":false,"rvalue":true,"count":2} ],
     thisVars: [ "this_h" ],
     localVars: [] },
  post:
   { body: "return this_h",
     args: [],
     thisVars: [ "this_h" ],
     localVars: [] }
 })

exports.argmin = compile({
  args:["index","array","shape"],
  pre:{
    body:"{this_v=Infinity;this_i=_inline_0_arg2_.slice(0)}",
    args:[
      {name:"_inline_0_arg0_",lvalue:false,rvalue:false,count:0},
      {name:"_inline_0_arg1_",lvalue:false,rvalue:false,count:0},
      {name:"_inline_0_arg2_",lvalue:false,rvalue:true,count:1}
      ],
    thisVars:["this_i","this_v"],
    localVars:[]},
  body:{
    body:"{if(_inline_1_arg1_<this_v){this_v=_inline_1_arg1_;for(var _inline_1_k=0;_inline_1_k<_inline_1_arg0_.length;++_inline_1_k){this_i[_inline_1_k]=_inline_1_arg0_[_inline_1_k]}}}",
    args:[
      {name:"_inline_1_arg0_",lvalue:false,rvalue:true,count:2},
      {name:"_inline_1_arg1_",lvalue:false,rvalue:true,count:2}],
    thisVars:["this_i","this_v"],
    localVars:["_inline_1_k"]},
  post:{
    body:"{return this_i}",
    args:[],
    thisVars:["this_i"],
    localVars:[]}
})

exports.argmax = compile({
  args:["index","array","shape"],
  pre:{
    body:"{this_v=-Infinity;this_i=_inline_0_arg2_.slice(0)}",
    args:[
      {name:"_inline_0_arg0_",lvalue:false,rvalue:false,count:0},
      {name:"_inline_0_arg1_",lvalue:false,rvalue:false,count:0},
      {name:"_inline_0_arg2_",lvalue:false,rvalue:true,count:1}
      ],
    thisVars:["this_i","this_v"],
    localVars:[]},
  body:{
    body:"{if(_inline_1_arg1_>this_v){this_v=_inline_1_arg1_;for(var _inline_1_k=0;_inline_1_k<_inline_1_arg0_.length;++_inline_1_k){this_i[_inline_1_k]=_inline_1_arg0_[_inline_1_k]}}}",
    args:[
      {name:"_inline_1_arg0_",lvalue:false,rvalue:true,count:2},
      {name:"_inline_1_arg1_",lvalue:false,rvalue:true,count:2}],
    thisVars:["this_i","this_v"],
    localVars:["_inline_1_k"]},
  post:{
    body:"{return this_i}",
    args:[],
    thisVars:["this_i"],
    localVars:[]}
})  

exports.random = makeOp({
  args: ["array"],
  pre: {args:[], body:"this_f=Math.random", thisVars:["this_f"]},
  body: {args: ["a"], body:"a=this_f()", thisVars:["this_f"]},
  funcName: "random"
})

exports.assign = makeOp({
  args:["array", "array"],
  body: {args:["a", "b"], body:"a=b"},
  funcName: "assign" })

exports.assigns = makeOp({
  args:["array", "scalar"],
  body: {args:["a", "b"], body:"a=b"},
  funcName: "assigns" })


exports.equals = compile({
  args:["array", "array"],
  pre: EmptyProc,
  body: {args:[{name:"x", lvalue:false, rvalue:true, count:1},
               {name:"y", lvalue:false, rvalue:true, count:1}], 
        body: "if(x!==y){return false}", 
        localVars: [], 
        thisVars: []},
  post: {args:[], localVars:[], thisVars:[], body:"return true"},
  funcName: "equals"
})



},{"cwise-compiler":4}],4:[function(require,module,exports){
"use strict"

var createThunk = require("./lib/thunk.js")

function Procedure() {
  this.argTypes = []
  this.shimArgs = []
  this.arrayArgs = []
  this.scalarArgs = []
  this.offsetArgs = []
  this.offsetArgIndex = []
  this.indexArgs = []
  this.shapeArgs = []
  this.funcName = ""
  this.pre = null
  this.body = null
  this.post = null
  this.debug = false
}

function compileCwise(user_args) {
  //Create procedure
  var proc = new Procedure()
  
  //Parse blocks
  proc.pre    = user_args.pre
  proc.body   = user_args.body
  proc.post   = user_args.post

  //Parse arguments
  var proc_args = user_args.args.slice(0)
  proc.argTypes = proc_args
  for(var i=0; i<proc_args.length; ++i) {
    var arg_type = proc_args[i]
    if(arg_type === "array") {
      proc.arrayArgs.push(i)
      proc.shimArgs.push("array" + i)
      if(i < proc.pre.args.length && proc.pre.args[i].count>0) {
        throw new Error("cwise: pre() block may not reference array args")
      }
      if(i < proc.post.args.length && proc.post.args[i].count>0) {
        throw new Error("cwise: post() block may not reference array args")
      }
    } else if(arg_type === "scalar") {
      proc.scalarArgs.push(i)
      proc.shimArgs.push("scalar" + i)
    } else if(arg_type === "index") {
      proc.indexArgs.push(i)
      if(i < proc.pre.args.length && proc.pre.args[i].count > 0) {
        throw new Error("cwise: pre() block may not reference array index")
      }
      if(i < proc.body.args.length && proc.body.args[i].lvalue) {
        throw new Error("cwise: body() block may not write to array index")
      }
      if(i < proc.post.args.length && proc.post.args[i].count > 0) {
        throw new Error("cwise: post() block may not reference array index")
      }
    } else if(arg_type === "shape") {
      proc.shapeArgs.push(i)
      if(i < proc.pre.args.length && proc.pre.args[i].lvalue) {
        throw new Error("cwise: pre() block may not write to array shape")
      }
      if(i < proc.body.args.length && proc.body.args[i].lvalue) {
        throw new Error("cwise: body() block may not write to array shape")
      }
      if(i < proc.post.args.length && proc.post.args[i].lvalue) {
        throw new Error("cwise: post() block may not write to array shape")
      }
    } else if(typeof arg_type === "object" && arg_type.offset) {
      proc.argTypes[i] = "offset"
      proc.offsetArgs.push({ array: arg_type.array, offset:arg_type.offset })
      proc.offsetArgIndex.push(i)
    } else {
      throw new Error("cwise: Unknown argument type " + proc_args[i])
    }
  }
  
  //Make sure at least one array argument was specified
  if(proc.arrayArgs.length <= 0) {
    throw new Error("cwise: No array arguments specified")
  }
  
  //Make sure arguments are correct
  if(proc.pre.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in pre() block")
  }
  if(proc.body.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in body() block")
  }
  if(proc.post.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in post() block")
  }

  //Check debug flag
  proc.debug = !!user_args.printCode || !!user_args.debug
  
  //Retrieve name
  proc.funcName = user_args.funcName || "cwise"
  
  //Read in block size
  proc.blockSize = user_args.blockSize || 64

  return createThunk(proc)
}

module.exports = compileCwise

},{"./lib/thunk.js":6}],5:[function(require,module,exports){
"use strict"

var uniq = require("uniq")

function innerFill(order, proc, body) {
  var dimension = order.length
    , nargs = proc.arrayArgs.length
    , has_index = proc.indexArgs.length>0
    , code = []
    , vars = []
    , idx=0, pidx=0, i, j
  for(i=0; i<dimension; ++i) {
    vars.push(["i",i,"=0"].join(""))
  }
  //Compute scan deltas
  for(j=0; j<nargs; ++j) {
    for(i=0; i<dimension; ++i) {
      pidx = idx
      idx = order[i]
      if(i === 0) {
        vars.push(["d",j,"s",i,"=t",j,"p",idx].join(""))
      } else {
        vars.push(["d",j,"s",i,"=(t",j,"p",idx,"-s",pidx,"*t",j,"p",pidx,")"].join(""))
      }
    }
  }
  code.push("var " + vars.join(","))
  //Scan loop
  for(i=dimension-1; i>=0; --i) {
    idx = order[i]
    code.push(["for(i",i,"=0;i",i,"<s",idx,";++i",i,"){"].join(""))
  }
  //Push body of inner loop
  code.push(body)
  //Advance scan pointers
  for(i=0; i<dimension; ++i) {
    pidx = idx
    idx = order[i]
    for(j=0; j<nargs; ++j) {
      code.push(["p",j,"+=d",j,"s",i].join(""))
    }
    if(has_index) {
      if(i > 0) {
        code.push(["index[",pidx,"]-=s",pidx].join(""))
      }
      code.push(["++index[",idx,"]"].join(""))
    }
    code.push("}")
  }
  return code.join("\n")
}

function outerFill(matched, order, proc, body) {
  var dimension = order.length
    , nargs = proc.arrayArgs.length
    , blockSize = proc.blockSize
    , has_index = proc.indexArgs.length > 0
    , code = []
  for(var i=0; i<nargs; ++i) {
    code.push(["var offset",i,"=p",i].join(""))
  }
  //Generate matched loops
  for(var i=matched; i<dimension; ++i) {
    code.push(["for(var j"+i+"=SS[", order[i], "]|0;j", i, ">0;){"].join(""))
    code.push(["if(j",i,"<",blockSize,"){"].join(""))
    code.push(["s",order[i],"=j",i].join(""))
    code.push(["j",i,"=0"].join(""))
    code.push(["}else{s",order[i],"=",blockSize].join(""))
    code.push(["j",i,"-=",blockSize,"}"].join(""))
    if(has_index) {
      code.push(["index[",order[i],"]=j",i].join(""))
    }
  }
  for(var i=0; i<nargs; ++i) {
    var indexStr = ["offset"+i]
    for(var j=matched; j<dimension; ++j) {
      indexStr.push(["j",j,"*t",i,"p",order[j]].join(""))
    }
    code.push(["p",i,"=(",indexStr.join("+"),")"].join(""))
  }
  code.push(innerFill(order, proc, body))
  for(var i=matched; i<dimension; ++i) {
    code.push("}")
  }
  return code.join("\n")
}

//Count the number of compatible inner orders
function countMatches(orders) {
  var matched = 0, dimension = orders[0].length
  while(matched < dimension) {
    for(var j=1; j<orders.length; ++j) {
      if(orders[j][matched] !== orders[0][matched]) {
        return matched
      }
    }
    ++matched
  }
  return matched
}

//Processes a block according to the given data types
function processBlock(block, proc, dtypes) {
  var code = block.body
  var pre = []
  var post = []
  for(var i=0; i<block.args.length; ++i) {
    var carg = block.args[i]
    if(carg.count <= 0) {
      continue
    }
    var re = new RegExp(carg.name, "g")
    var ptrStr = ""
    var arrNum = proc.arrayArgs.indexOf(i)
    switch(proc.argTypes[i]) {
      case "offset":
        var offArgIndex = proc.offsetArgIndex.indexOf(i)
        var offArg = proc.offsetArgs[offArgIndex]
        arrNum = offArg.array
        ptrStr = "+q" + offArgIndex
      case "array":
        ptrStr = "p" + arrNum + ptrStr
        var localStr = "l" + i
        var arrStr = "a" + arrNum
        if(carg.count === 1) {
          if(dtypes[arrNum] === "generic") {
            if(carg.lvalue) {
              pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join(""))
              code = code.replace(re, localStr)
              post.push([arrStr, ".set(", ptrStr, ",", localStr,")"].join(""))
            } else {
              code = code.replace(re, [arrStr, ".get(", ptrStr, ")"].join(""))
            }
          } else {
            code = code.replace(re, [arrStr, "[", ptrStr, "]"].join(""))
          }
        } else if(dtypes[arrNum] === "generic") {
          pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join(""))
          code = code.replace(re, localStr)
          if(carg.lvalue) {
            post.push([arrStr, ".set(", ptrStr, ",", localStr,")"].join(""))
          }
        } else {
          pre.push(["var ", localStr, "=", arrStr, "[", ptrStr, "]"].join(""))
          code = code.replace(re, localStr)
          if(carg.lvalue) {
            post.push([arrStr, "[", ptrStr, "]=", localStr].join(""))
          }
        }
      break
      case "scalar":
        code = code.replace(re, "Y" + proc.scalarArgs.indexOf(i))
      break
      case "index":
        code = code.replace(re, "index")
      break
      case "shape":
        code = code.replace(re, "shape")
      break
    }
  }
  return [pre.join("\n"), code, post.join("\n")].join("\n").trim()
}

function typeSummary(dtypes) {
  var summary = new Array(dtypes.length)
  var allEqual = true
  for(var i=0; i<dtypes.length; ++i) {
    var t = dtypes[i]
    var digits = t.match(/\d+/)
    if(!digits) {
      digits = ""
    } else {
      digits = digits[0]
    }
    if(t.charAt(0) === 0) {
      summary[i] = "u" + t.charAt(1) + digits
    } else {
      summary[i] = t.charAt(0) + digits
    }
    if(i > 0) {
      allEqual = allEqual && summary[i] === summary[i-1]
    }
  }
  if(allEqual) {
    return summary[0]
  }
  return summary.join("")
}

//Generates a cwise operator
function generateCWiseOp(proc, typesig) {

  //Compute dimension
  var dimension = typesig[1].length|0
  var orders = new Array(proc.arrayArgs.length)
  var dtypes = new Array(proc.arrayArgs.length)

  //First create arguments for procedure
  var arglist = ["SS"]
  var code = ["'use strict'"]
  var vars = []
  
  for(var j=0; j<dimension; ++j) {
    vars.push(["s", j, "=SS[", j, "]"].join(""))
  }
  for(var i=0; i<proc.arrayArgs.length; ++i) {
    arglist.push("a"+i)
    arglist.push("t"+i)
    arglist.push("p"+i)
    dtypes[i] = typesig[2*i]
    orders[i] = typesig[2*i+1]
    
    for(var j=0; j<dimension; ++j) {
      vars.push(["t",i,"p",j,"=t",i,"[",j,"]"].join(""))
    }
  }
  for(var i=0; i<proc.scalarArgs.length; ++i) {
    arglist.push("Y" + i)
  }
  if(proc.shapeArgs.length > 0) {
    vars.push("shape=SS.slice(0)")
  }
  if(proc.indexArgs.length > 0) {
    var zeros = new Array(dimension)
    for(var i=0; i<dimension; ++i) {
      zeros[i] = "0"
    }
    vars.push(["index=[", zeros.join(","), "]"].join(""))
  }
  for(var i=0; i<proc.offsetArgs.length; ++i) {
    var off_arg = proc.offsetArgs[i]
    var init_string = []
    for(var j=0; j<off_arg.offset.length; ++j) {
      if(off_arg.offset[j] === 0) {
        continue
      } else if(off_arg.offset[j] === 1) {
        init_string.push(["t", off_arg.array, "p", j].join(""))      
      } else {
        init_string.push([off_arg.offset[j], "*t", off_arg.array, "p", j].join(""))
      }
    }
    if(init_string.length === 0) {
      vars.push("q" + i + "=0")
    } else {
      vars.push(["q", i, "=", init_string.join("+")].join(""))
    }
  }

  //Prepare this variables
  var thisVars = uniq([].concat(proc.pre.thisVars)
                      .concat(proc.body.thisVars)
                      .concat(proc.post.thisVars))
  vars = vars.concat(thisVars)
  code.push("var " + vars.join(","))
  for(var i=0; i<proc.arrayArgs.length; ++i) {
    code.push("p"+i+"|=0")
  }
  
  //Inline prelude
  if(proc.pre.body.length > 3) {
    code.push(processBlock(proc.pre, proc, dtypes))
  }

  //Process body
  var body = processBlock(proc.body, proc, dtypes)
  var matched = countMatches(orders)
  if(matched < dimension) {
    code.push(outerFill(matched, orders[0], proc, body))
  } else {
    code.push(innerFill(orders[0], proc, body))
  }

  //Inline epilog
  if(proc.post.body.length > 3) {
    code.push(processBlock(proc.post, proc, dtypes))
  }
  
  if(proc.debug) {
    console.log("Generated cwise routine for ", typesig, ":\n\n", code.join("\n"))
  }
  
  var loopName = [(proc.funcName||"unnamed"), "_cwise_loop_", orders[0].join("s"),"m",matched,typeSummary(dtypes)].join("")
  var f = new Function(["function ",loopName,"(", arglist.join(","),"){", code.join("\n"),"} return ", loopName].join(""))
  return f()
}
module.exports = generateCWiseOp
},{"uniq":7}],6:[function(require,module,exports){
"use strict"

var compile = require("./compile.js")

function createThunk(proc) {
  var code = ["'use strict'", "var CACHED={}"]
  var vars = []
  var thunkName = proc.funcName + "_cwise_thunk"
  
  //Build thunk
  code.push(["return function ", thunkName, "(", proc.shimArgs.join(","), "){"].join(""))
  var typesig = []
  var string_typesig = []
  var proc_args = [["array",proc.arrayArgs[0],".shape"].join("")]
  for(var i=0; i<proc.arrayArgs.length; ++i) {
    var j = proc.arrayArgs[i]
    vars.push(["t", j, "=array", j, ".dtype,",
               "r", j, "=array", j, ".order"].join(""))
    typesig.push("t" + j)
    typesig.push("r" + j)
    string_typesig.push("t"+j)
    string_typesig.push("r"+j+".join()")
    proc_args.push("array" + j + ".data")
    proc_args.push("array" + j + ".stride")
    proc_args.push("array" + j + ".offset|0")
  }
  for(var i=0; i<proc.scalarArgs.length; ++i) {
    proc_args.push("scalar" + proc.scalarArgs[i])
  }
  vars.push(["type=[", string_typesig.join(","), "].join()"].join(""))
  vars.push("proc=CACHED[type]")
  code.push("var " + vars.join(","))
  
  code.push(["if(!proc){",
             "CACHED[type]=proc=compile([", typesig.join(","), "])}",
             "return proc(", proc_args.join(","), ")}"].join(""))

  if(proc.debug) {
    console.log("Generated thunk:", code.join("\n"))
  }
  
  //Compile thunk
  var thunk = new Function("compile", code.join("\n"))
  return thunk(compile.bind(undefined, proc))
}

module.exports = createThunk

},{"./compile.js":5}],7:[function(require,module,exports){
"use strict"

function unique_pred(list, compare) {
  var ptr = 1
    , len = list.length
    , a=list[0], b=list[0]
  for(var i=1; i<len; ++i) {
    b = a
    a = list[i]
    if(compare(a, b)) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique_eq(list) {
  var ptr = 1
    , len = list.length
    , a=list[0], b = list[0]
  for(var i=1; i<len; ++i, b=a) {
    b = a
    a = list[i]
    if(a !== b) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique(list, compare, sorted) {
  if(list.length === 0) {
    return list
  }
  if(compare) {
    if(!sorted) {
      list.sort(compare)
    }
    return unique_pred(list, compare)
  }
  if(!sorted) {
    list.sort()
  }
  return unique_eq(list)
}

module.exports = unique

},{}],8:[function(require,module,exports){
/**
 * Bit twiddling hacks for JavaScript.
 *
 * Author: Mikola Lysenko
 *
 * Ported from Stanford bit twiddling hack library:
 *    http://graphics.stanford.edu/~seander/bithacks.html
 */

"use strict"; "use restrict";

//Number of bits in an integer
var INT_BITS = 32;

//Constants
exports.INT_BITS  = INT_BITS;
exports.INT_MAX   =  0x7fffffff;
exports.INT_MIN   = -1<<(INT_BITS-1);

//Returns -1, 0, +1 depending on sign of x
exports.sign = function(v) {
  return (v > 0) - (v < 0);
}

//Computes absolute value of integer
exports.abs = function(v) {
  var mask = v >> (INT_BITS-1);
  return (v ^ mask) - mask;
}

//Computes minimum of integers x and y
exports.min = function(x, y) {
  return y ^ ((x ^ y) & -(x < y));
}

//Computes maximum of integers x and y
exports.max = function(x, y) {
  return x ^ ((x ^ y) & -(x < y));
}

//Checks if a number is a power of two
exports.isPow2 = function(v) {
  return !(v & (v-1)) && (!!v);
}

//Computes log base 2 of v
exports.log2 = function(v) {
  var r, shift;
  r =     (v > 0xFFFF) << 4; v >>>= r;
  shift = (v > 0xFF  ) << 3; v >>>= shift; r |= shift;
  shift = (v > 0xF   ) << 2; v >>>= shift; r |= shift;
  shift = (v > 0x3   ) << 1; v >>>= shift; r |= shift;
  return r | (v >> 1);
}

//Computes log base 10 of v
exports.log10 = function(v) {
  return  (v >= 1000000000) ? 9 : (v >= 100000000) ? 8 : (v >= 10000000) ? 7 :
          (v >= 1000000) ? 6 : (v >= 100000) ? 5 : (v >= 10000) ? 4 :
          (v >= 1000) ? 3 : (v >= 100) ? 2 : (v >= 10) ? 1 : 0;
}

//Counts number of bits
exports.popCount = function(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return ((v + (v >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24;
}

//Counts number of trailing zeros
function countTrailingZeros(v) {
  var c = 32;
  v &= -v;
  if (v) c--;
  if (v & 0x0000FFFF) c -= 16;
  if (v & 0x00FF00FF) c -= 8;
  if (v & 0x0F0F0F0F) c -= 4;
  if (v & 0x33333333) c -= 2;
  if (v & 0x55555555) c -= 1;
  return c;
}
exports.countTrailingZeros = countTrailingZeros;

//Rounds to next power of 2
exports.nextPow2 = function(v) {
  v += v === 0;
  --v;
  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;
  return v + 1;
}

//Rounds down to previous power of 2
exports.prevPow2 = function(v) {
  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;
  return v - (v>>>1);
}

//Computes parity of word
exports.parity = function(v) {
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v &= 0xf;
  return (0x6996 >>> v) & 1;
}

var REVERSE_TABLE = new Array(256);

(function(tab) {
  for(var i=0; i<256; ++i) {
    var v = i, r = i, s = 7;
    for (v >>>= 1; v; v >>>= 1) {
      r <<= 1;
      r |= v & 1;
      --s;
    }
    tab[i] = (r << s) & 0xff;
  }
})(REVERSE_TABLE);

//Reverse bits in a 32 bit word
exports.reverse = function(v) {
  return  (REVERSE_TABLE[ v         & 0xff] << 24) |
          (REVERSE_TABLE[(v >>> 8)  & 0xff] << 16) |
          (REVERSE_TABLE[(v >>> 16) & 0xff] << 8)  |
           REVERSE_TABLE[(v >>> 24) & 0xff];
}

//Interleave bits of 2 coordinates with 16 bits.  Useful for fast quadtree codes
exports.interleave2 = function(x, y) {
  x &= 0xFFFF;
  x = (x | (x << 8)) & 0x00FF00FF;
  x = (x | (x << 4)) & 0x0F0F0F0F;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;

  y &= 0xFFFF;
  y = (y | (y << 8)) & 0x00FF00FF;
  y = (y | (y << 4)) & 0x0F0F0F0F;
  y = (y | (y << 2)) & 0x33333333;
  y = (y | (y << 1)) & 0x55555555;

  return x | (y << 1);
}

//Extracts the nth interleaved component
exports.deinterleave2 = function(v, n) {
  v = (v >>> n) & 0x55555555;
  v = (v | (v >>> 1))  & 0x33333333;
  v = (v | (v >>> 2))  & 0x0F0F0F0F;
  v = (v | (v >>> 4))  & 0x00FF00FF;
  v = (v | (v >>> 16)) & 0x000FFFF;
  return (v << 16) >> 16;
}


//Interleave bits of 3 coordinates, each with 10 bits.  Useful for fast octree codes
exports.interleave3 = function(x, y, z) {
  x &= 0x3FF;
  x  = (x | (x<<16)) & 4278190335;
  x  = (x | (x<<8))  & 251719695;
  x  = (x | (x<<4))  & 3272356035;
  x  = (x | (x<<2))  & 1227133513;

  y &= 0x3FF;
  y  = (y | (y<<16)) & 4278190335;
  y  = (y | (y<<8))  & 251719695;
  y  = (y | (y<<4))  & 3272356035;
  y  = (y | (y<<2))  & 1227133513;
  x |= (y << 1);
  
  z &= 0x3FF;
  z  = (z | (z<<16)) & 4278190335;
  z  = (z | (z<<8))  & 251719695;
  z  = (z | (z<<4))  & 3272356035;
  z  = (z | (z<<2))  & 1227133513;
  
  return x | (z << 2);
}

//Extracts nth interleaved component of a 3-tuple
exports.deinterleave3 = function(v, n) {
  v = (v >>> n)       & 1227133513;
  v = (v | (v>>>2))   & 3272356035;
  v = (v | (v>>>4))   & 251719695;
  v = (v | (v>>>8))   & 4278190335;
  v = (v | (v>>>16))  & 0x3FF;
  return (v<<22)>>22;
}

//Computes next combination in colexicographic order (this is mistakenly called nextPermutation on the bit twiddling hacks page)
exports.nextCombination = function(v) {
  var t = v | (v - 1);
  return (t + 1) | (((~t & -~t) - 1) >>> (countTrailingZeros(v) + 1));
}


},{}],9:[function(require,module,exports){
"use strict"

function dupe_array(count, value, i) {
  var c = count[i]|0
  if(c <= 0) {
    return []
  }
  var result = new Array(c), j
  if(i === count.length-1) {
    for(j=0; j<c; ++j) {
      result[j] = value
    }
  } else {
    for(j=0; j<c; ++j) {
      result[j] = dupe_array(count, value, i+1)
    }
  }
  return result
}

function dupe_number(count, value) {
  var result, i
  result = new Array(count)
  for(i=0; i<count; ++i) {
    result[i] = value
  }
  return result
}

function dupe(count, value) {
  if(typeof value === "undefined") {
    value = 0
  }
  switch(typeof count) {
    case "number":
      if(count > 0) {
        return dupe_number(count|0, value)
      }
    break
    case "object":
      if(typeof (count.length) === "number") {
        return dupe_array(count, value, 0)
      }
    break
  }
  return []
}

module.exports = dupe
},{}],10:[function(require,module,exports){
(function (global,Buffer){
'use strict'

var bits = require('bit-twiddle')
var dup = require('dup')

//Legacy pool support
if(!global.__TYPEDARRAY_POOL) {
  global.__TYPEDARRAY_POOL = {
      UINT8   : dup([32, 0])
    , UINT16  : dup([32, 0])
    , UINT32  : dup([32, 0])
    , INT8    : dup([32, 0])
    , INT16   : dup([32, 0])
    , INT32   : dup([32, 0])
    , FLOAT   : dup([32, 0])
    , DOUBLE  : dup([32, 0])
    , DATA    : dup([32, 0])
    , UINT8C  : dup([32, 0])
    , BUFFER  : dup([32, 0])
  }
}

var hasUint8C = (typeof Uint8ClampedArray) !== 'undefined'
var POOL = global.__TYPEDARRAY_POOL

//Upgrade pool
if(!POOL.UINT8C) {
  POOL.UINT8C = dup([32, 0])
}
if(!POOL.BUFFER) {
  POOL.BUFFER = dup([32, 0])
}

//New technique: Only allocate from ArrayBufferView and Buffer
var DATA    = POOL.DATA
  , BUFFER  = POOL.BUFFER

exports.free = function free(array) {
  if(Buffer.isBuffer(array)) {
    BUFFER[bits.log2(array.length)].push(array)
  } else {
    if(Object.prototype.toString.call(array) !== '[object ArrayBuffer]') {
      array = array.buffer
    }
    if(!array) {
      return
    }
    var n = array.length || array.byteLength
    var log_n = bits.log2(n)|0
    DATA[log_n].push(array)
  }
}

function freeArrayBuffer(buffer) {
  if(!buffer) {
    return
  }
  var n = buffer.length || buffer.byteLength
  var log_n = bits.log2(n)
  DATA[log_n].push(buffer)
}

function freeTypedArray(array) {
  freeArrayBuffer(array.buffer)
}

exports.freeUint8 =
exports.freeUint16 =
exports.freeUint32 =
exports.freeInt8 =
exports.freeInt16 =
exports.freeInt32 =
exports.freeFloat32 = 
exports.freeFloat =
exports.freeFloat64 = 
exports.freeDouble = 
exports.freeUint8Clamped = 
exports.freeDataView = freeTypedArray

exports.freeArrayBuffer = freeArrayBuffer

exports.freeBuffer = function freeBuffer(array) {
  BUFFER[bits.log2(array.length)].push(array)
}

exports.malloc = function malloc(n, dtype) {
  if(dtype === undefined || dtype === 'arraybuffer') {
    return mallocArrayBuffer(n)
  } else {
    switch(dtype) {
      case 'uint8':
        return mallocUint8(n)
      case 'uint16':
        return mallocUint16(n)
      case 'uint32':
        return mallocUint32(n)
      case 'int8':
        return mallocInt8(n)
      case 'int16':
        return mallocInt16(n)
      case 'int32':
        return mallocInt32(n)
      case 'float':
      case 'float32':
        return mallocFloat(n)
      case 'double':
      case 'float64':
        return mallocDouble(n)
      case 'uint8_clamped':
        return mallocUint8Clamped(n)
      case 'buffer':
        return mallocBuffer(n)
      case 'data':
      case 'dataview':
        return mallocDataView(n)

      default:
        return null
    }
  }
  return null
}

function mallocArrayBuffer(n) {
  var n = bits.nextPow2(n)
  var log_n = bits.log2(n)
  var d = DATA[log_n]
  if(d.length > 0) {
    return d.pop()
  }
  return new ArrayBuffer(n)
}
exports.mallocArrayBuffer = mallocArrayBuffer

function mallocUint8(n) {
  return new Uint8Array(mallocArrayBuffer(n), 0, n)
}
exports.mallocUint8 = mallocUint8

function mallocUint16(n) {
  return new Uint16Array(mallocArrayBuffer(2*n), 0, n)
}
exports.mallocUint16 = mallocUint16

function mallocUint32(n) {
  return new Uint32Array(mallocArrayBuffer(4*n), 0, n)
}
exports.mallocUint32 = mallocUint32

function mallocInt8(n) {
  return new Int8Array(mallocArrayBuffer(n), 0, n)
}
exports.mallocInt8 = mallocInt8

function mallocInt16(n) {
  return new Int16Array(mallocArrayBuffer(2*n), 0, n)
}
exports.mallocInt16 = mallocInt16

function mallocInt32(n) {
  return new Int32Array(mallocArrayBuffer(4*n), 0, n)
}
exports.mallocInt32 = mallocInt32

function mallocFloat(n) {
  return new Float32Array(mallocArrayBuffer(4*n), 0, n)
}
exports.mallocFloat32 = exports.mallocFloat = mallocFloat

function mallocDouble(n) {
  return new Float64Array(mallocArrayBuffer(8*n), 0, n)
}
exports.mallocFloat64 = exports.mallocDouble = mallocDouble

function mallocUint8Clamped(n) {
  if(hasUint8C) {
    return new Uint8ClampedArray(mallocArrayBuffer(n), 0, n)
  } else {
    return mallocUint8(n)
  }
}
exports.mallocUint8Clamped = mallocUint8Clamped

function mallocDataView(n) {
  return new DataView(mallocArrayBuffer(n), 0, n)
}
exports.mallocDataView = mallocDataView

function mallocBuffer(n) {
  n = bits.nextPow2(n)
  var log_n = bits.log2(n)
  var cache = BUFFER[log_n]
  if(cache.length > 0) {
    return cache.pop()
  }
  return new Buffer(n)
}
exports.mallocBuffer = mallocBuffer

exports.clearCache = function clearCache() {
  for(var i=0; i<32; ++i) {
    POOL.UINT8[i].length = 0
    POOL.UINT16[i].length = 0
    POOL.UINT32[i].length = 0
    POOL.INT8[i].length = 0
    POOL.INT16[i].length = 0
    POOL.INT32[i].length = 0
    POOL.FLOAT[i].length = 0
    POOL.DOUBLE[i].length = 0
    POOL.UINT8C[i].length = 0
    DATA[i].length = 0
    BUFFER[i].length = 0
  }
}
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"bit-twiddle":8,"buffer":250,"dup":9}],11:[function(require,module,exports){
// Copyright (C) 2011 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Install a leaky WeakMap emulation on platforms that
 * don't provide a built-in one.
 *
 * <p>Assumes that an ES5 platform where, if {@code WeakMap} is
 * already present, then it conforms to the anticipated ES6
 * specification. To run this file on an ES5 or almost ES5
 * implementation where the {@code WeakMap} specification does not
 * quite conform, run <code>repairES5.js</code> first.
 *
 * <p>Even though WeakMapModule is not global, the linter thinks it
 * is, which is why it is in the overrides list below.
 *
 * <p>NOTE: Before using this WeakMap emulation in a non-SES
 * environment, see the note below about hiddenRecord.
 *
 * @author Mark S. Miller
 * @requires crypto, ArrayBuffer, Uint8Array, navigator, console
 * @overrides WeakMap, ses, Proxy
 * @overrides WeakMapModule
 */

/**
 * This {@code WeakMap} emulation is observably equivalent to the
 * ES-Harmony WeakMap, but with leakier garbage collection properties.
 *
 * <p>As with true WeakMaps, in this emulation, a key does not
 * retain maps indexed by that key and (crucially) a map does not
 * retain the keys it indexes. A map by itself also does not retain
 * the values associated with that map.
 *
 * <p>However, the values associated with a key in some map are
 * retained so long as that key is retained and those associations are
 * not overridden. For example, when used to support membranes, all
 * values exported from a given membrane will live for the lifetime
 * they would have had in the absence of an interposed membrane. Even
 * when the membrane is revoked, all objects that would have been
 * reachable in the absence of revocation will still be reachable, as
 * far as the GC can tell, even though they will no longer be relevant
 * to ongoing computation.
 *
 * <p>The API implemented here is approximately the API as implemented
 * in FF6.0a1 and agreed to by MarkM, Andreas Gal, and Dave Herman,
 * rather than the offially approved proposal page. TODO(erights):
 * upgrade the ecmascript WeakMap proposal page to explain this API
 * change and present to EcmaScript committee for their approval.
 *
 * <p>The first difference between the emulation here and that in
 * FF6.0a1 is the presence of non enumerable {@code get___, has___,
 * set___, and delete___} methods on WeakMap instances to represent
 * what would be the hidden internal properties of a primitive
 * implementation. Whereas the FF6.0a1 WeakMap.prototype methods
 * require their {@code this} to be a genuine WeakMap instance (i.e.,
 * an object of {@code [[Class]]} "WeakMap}), since there is nothing
 * unforgeable about the pseudo-internal method names used here,
 * nothing prevents these emulated prototype methods from being
 * applied to non-WeakMaps with pseudo-internal methods of the same
 * names.
 *
 * <p>Another difference is that our emulated {@code
 * WeakMap.prototype} is not itself a WeakMap. A problem with the
 * current FF6.0a1 API is that WeakMap.prototype is itself a WeakMap
 * providing ambient mutability and an ambient communications
 * channel. Thus, if a WeakMap is already present and has this
 * problem, repairES5.js wraps it in a safe wrappper in order to
 * prevent access to this channel. (See
 * PATCH_MUTABLE_FROZEN_WEAKMAP_PROTO in repairES5.js).
 */

/**
 * If this is a full <a href=
 * "http://code.google.com/p/es-lab/wiki/SecureableES5"
 * >secureable ES5</a> platform and the ES-Harmony {@code WeakMap} is
 * absent, install an approximate emulation.
 *
 * <p>If WeakMap is present but cannot store some objects, use our approximate
 * emulation as a wrapper.
 *
 * <p>If this is almost a secureable ES5 platform, then WeakMap.js
 * should be run after repairES5.js.
 *
 * <p>See {@code WeakMap} for documentation of the garbage collection
 * properties of this WeakMap emulation.
 */
(function WeakMapModule() {
  "use strict";

  if (typeof ses !== 'undefined' && ses.ok && !ses.ok()) {
    // already too broken, so give up
    return;
  }

  /**
   * In some cases (current Firefox), we must make a choice betweeen a
   * WeakMap which is capable of using all varieties of host objects as
   * keys and one which is capable of safely using proxies as keys. See
   * comments below about HostWeakMap and DoubleWeakMap for details.
   *
   * This function (which is a global, not exposed to guests) marks a
   * WeakMap as permitted to do what is necessary to index all host
   * objects, at the cost of making it unsafe for proxies.
   *
   * Do not apply this function to anything which is not a genuine
   * fresh WeakMap.
   */
  function weakMapPermitHostObjects(map) {
    // identity of function used as a secret -- good enough and cheap
    if (map.permitHostObjects___) {
      map.permitHostObjects___(weakMapPermitHostObjects);
    }
  }
  if (typeof ses !== 'undefined') {
    ses.weakMapPermitHostObjects = weakMapPermitHostObjects;
  }

  // IE 11 has no Proxy but has a broken WeakMap such that we need to patch
  // it using DoubleWeakMap; this flag tells DoubleWeakMap so.
  var doubleWeakMapCheckSilentFailure = false;

  // Check if there is already a good-enough WeakMap implementation, and if so
  // exit without replacing it.
  if (typeof WeakMap === 'function') {
    var HostWeakMap = WeakMap;
    // There is a WeakMap -- is it good enough?
    if (typeof navigator !== 'undefined' &&
        /Firefox/.test(navigator.userAgent)) {
      // We're now *assuming not*, because as of this writing (2013-05-06)
      // Firefox's WeakMaps have a miscellany of objects they won't accept, and
      // we don't want to make an exhaustive list, and testing for just one
      // will be a problem if that one is fixed alone (as they did for Event).

      // If there is a platform that we *can* reliably test on, here's how to
      // do it:
      //  var problematic = ... ;
      //  var testHostMap = new HostWeakMap();
      //  try {
      //    testHostMap.set(problematic, 1);  // Firefox 20 will throw here
      //    if (testHostMap.get(problematic) === 1) {
      //      return;
      //    }
      //  } catch (e) {}

    } else {
      // IE 11 bug: WeakMaps silently fail to store frozen objects.
      var testMap = new HostWeakMap();
      var testObject = Object.freeze({});
      testMap.set(testObject, 1);
      if (testMap.get(testObject) !== 1) {
        doubleWeakMapCheckSilentFailure = true;
        // Fall through to installing our WeakMap.
      } else {
        module.exports = WeakMap;
        return;
      }
    }
  }

  var hop = Object.prototype.hasOwnProperty;
  var gopn = Object.getOwnPropertyNames;
  var defProp = Object.defineProperty;
  var isExtensible = Object.isExtensible;

  /**
   * Security depends on HIDDEN_NAME being both <i>unguessable</i> and
   * <i>undiscoverable</i> by untrusted code.
   *
   * <p>Given the known weaknesses of Math.random() on existing
   * browsers, it does not generate unguessability we can be confident
   * of.
   *
   * <p>It is the monkey patching logic in this file that is intended
   * to ensure undiscoverability. The basic idea is that there are
   * three fundamental means of discovering properties of an object:
   * The for/in loop, Object.keys(), and Object.getOwnPropertyNames(),
   * as well as some proposed ES6 extensions that appear on our
   * whitelist. The first two only discover enumerable properties, and
   * we only use HIDDEN_NAME to name a non-enumerable property, so the
   * only remaining threat should be getOwnPropertyNames and some
   * proposed ES6 extensions that appear on our whitelist. We monkey
   * patch them to remove HIDDEN_NAME from the list of properties they
   * returns.
   *
   * <p>TODO(erights): On a platform with built-in Proxies, proxies
   * could be used to trap and thereby discover the HIDDEN_NAME, so we
   * need to monkey patch Proxy.create, Proxy.createFunction, etc, in
   * order to wrap the provided handler with the real handler which
   * filters out all traps using HIDDEN_NAME.
   *
   * <p>TODO(erights): Revisit Mike Stay's suggestion that we use an
   * encapsulated function at a not-necessarily-secret name, which
   * uses the Stiegler shared-state rights amplification pattern to
   * reveal the associated value only to the WeakMap in which this key
   * is associated with that value. Since only the key retains the
   * function, the function can also remember the key without causing
   * leakage of the key, so this doesn't violate our general gc
   * goals. In addition, because the name need not be a guarded
   * secret, we could efficiently handle cross-frame frozen keys.
   */
  var HIDDEN_NAME_PREFIX = 'weakmap:';
  var HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'ident:' + Math.random() + '___';

  if (typeof crypto !== 'undefined' &&
      typeof crypto.getRandomValues === 'function' &&
      typeof ArrayBuffer === 'function' &&
      typeof Uint8Array === 'function') {
    var ab = new ArrayBuffer(25);
    var u8s = new Uint8Array(ab);
    crypto.getRandomValues(u8s);
    HIDDEN_NAME = HIDDEN_NAME_PREFIX + 'rand:' +
      Array.prototype.map.call(u8s, function(u8) {
        return (u8 % 36).toString(36);
      }).join('') + '___';
  }

  function isNotHiddenName(name) {
    return !(
        name.substr(0, HIDDEN_NAME_PREFIX.length) == HIDDEN_NAME_PREFIX &&
        name.substr(name.length - 3) === '___');
  }

  /**
   * Monkey patch getOwnPropertyNames to avoid revealing the
   * HIDDEN_NAME.
   *
   * <p>The ES5.1 spec requires each name to appear only once, but as
   * of this writing, this requirement is controversial for ES6, so we
   * made this code robust against this case. If the resulting extra
   * search turns out to be expensive, we can probably relax this once
   * ES6 is adequately supported on all major browsers, iff no browser
   * versions we support at that time have relaxed this constraint
   * without providing built-in ES6 WeakMaps.
   */
  defProp(Object, 'getOwnPropertyNames', {
    value: function fakeGetOwnPropertyNames(obj) {
      return gopn(obj).filter(isNotHiddenName);
    }
  });

  /**
   * getPropertyNames is not in ES5 but it is proposed for ES6 and
   * does appear in our whitelist, so we need to clean it too.
   */
  if ('getPropertyNames' in Object) {
    var originalGetPropertyNames = Object.getPropertyNames;
    defProp(Object, 'getPropertyNames', {
      value: function fakeGetPropertyNames(obj) {
        return originalGetPropertyNames(obj).filter(isNotHiddenName);
      }
    });
  }

  /**
   * <p>To treat objects as identity-keys with reasonable efficiency
   * on ES5 by itself (i.e., without any object-keyed collections), we
   * need to add a hidden property to such key objects when we
   * can. This raises several issues:
   * <ul>
   * <li>Arranging to add this property to objects before we lose the
   *     chance, and
   * <li>Hiding the existence of this new property from most
   *     JavaScript code.
   * <li>Preventing <i>certification theft</i>, where one object is
   *     created falsely claiming to be the key of an association
   *     actually keyed by another object.
   * <li>Preventing <i>value theft</i>, where untrusted code with
   *     access to a key object but not a weak map nevertheless
   *     obtains access to the value associated with that key in that
   *     weak map.
   * </ul>
   * We do so by
   * <ul>
   * <li>Making the name of the hidden property unguessable, so "[]"
   *     indexing, which we cannot intercept, cannot be used to access
   *     a property without knowing the name.
   * <li>Making the hidden property non-enumerable, so we need not
   *     worry about for-in loops or {@code Object.keys},
   * <li>monkey patching those reflective methods that would
   *     prevent extensions, to add this hidden property first,
   * <li>monkey patching those methods that would reveal this
   *     hidden property.
   * </ul>
   * Unfortunately, because of same-origin iframes, we cannot reliably
   * add this hidden property before an object becomes
   * non-extensible. Instead, if we encounter a non-extensible object
   * without a hidden record that we can detect (whether or not it has
   * a hidden record stored under a name secret to us), then we just
   * use the key object itself to represent its identity in a brute
   * force leaky map stored in the weak map, losing all the advantages
   * of weakness for these.
   */
  function getHiddenRecord(key) {
    if (key !== Object(key)) {
      throw new TypeError('Not an object: ' + key);
    }
    var hiddenRecord = key[HIDDEN_NAME];
    if (hiddenRecord && hiddenRecord.key === key) { return hiddenRecord; }
    if (!isExtensible(key)) {
      // Weak map must brute force, as explained in doc-comment above.
      return void 0;
    }

    // The hiddenRecord and the key point directly at each other, via
    // the "key" and HIDDEN_NAME properties respectively. The key
    // field is for quickly verifying that this hidden record is an
    // own property, not a hidden record from up the prototype chain.
    //
    // NOTE: Because this WeakMap emulation is meant only for systems like
    // SES where Object.prototype is frozen without any numeric
    // properties, it is ok to use an object literal for the hiddenRecord.
    // This has two advantages:
    // * It is much faster in a performance critical place
    // * It avoids relying on Object.create(null), which had been
    //   problematic on Chrome 28.0.1480.0. See
    //   https://code.google.com/p/google-caja/issues/detail?id=1687
    hiddenRecord = { key: key };

    // When using this WeakMap emulation on platforms where
    // Object.prototype might not be frozen and Object.create(null) is
    // reliable, use the following two commented out lines instead.
    // hiddenRecord = Object.create(null);
    // hiddenRecord.key = key;

    // Please contact us if you need this to work on platforms where
    // Object.prototype might not be frozen and
    // Object.create(null) might not be reliable.

    try {
      defProp(key, HIDDEN_NAME, {
        value: hiddenRecord,
        writable: false,
        enumerable: false,
        configurable: false
      });
      return hiddenRecord;
    } catch (error) {
      // Under some circumstances, isExtensible seems to misreport whether
      // the HIDDEN_NAME can be defined.
      // The circumstances have not been isolated, but at least affect
      // Node.js v0.10.26 on TravisCI / Linux, but not the same version of
      // Node.js on OS X.
      return void 0;
    }
  }

  /**
   * Monkey patch operations that would make their argument
   * non-extensible.
   *
   * <p>The monkey patched versions throw a TypeError if their
   * argument is not an object, so it should only be done to functions
   * that should throw a TypeError anyway if their argument is not an
   * object.
   */
  (function(){
    var oldFreeze = Object.freeze;
    defProp(Object, 'freeze', {
      value: function identifyingFreeze(obj) {
        getHiddenRecord(obj);
        return oldFreeze(obj);
      }
    });
    var oldSeal = Object.seal;
    defProp(Object, 'seal', {
      value: function identifyingSeal(obj) {
        getHiddenRecord(obj);
        return oldSeal(obj);
      }
    });
    var oldPreventExtensions = Object.preventExtensions;
    defProp(Object, 'preventExtensions', {
      value: function identifyingPreventExtensions(obj) {
        getHiddenRecord(obj);
        return oldPreventExtensions(obj);
      }
    });
  })();

  function constFunc(func) {
    func.prototype = null;
    return Object.freeze(func);
  }

  var calledAsFunctionWarningDone = false;
  function calledAsFunctionWarning() {
    // Future ES6 WeakMap is currently (2013-09-10) expected to reject WeakMap()
    // but we used to permit it and do it ourselves, so warn only.
    if (!calledAsFunctionWarningDone && typeof console !== 'undefined') {
      calledAsFunctionWarningDone = true;
      console.warn('WeakMap should be invoked as new WeakMap(), not ' +
          'WeakMap(). This will be an error in the future.');
    }
  }

  var nextId = 0;

  var OurWeakMap = function() {
    if (!(this instanceof OurWeakMap)) {  // approximate test for new ...()
      calledAsFunctionWarning();
    }

    // We are currently (12/25/2012) never encountering any prematurely
    // non-extensible keys.
    var keys = []; // brute force for prematurely non-extensible keys.
    var values = []; // brute force for corresponding values.
    var id = nextId++;

    function get___(key, opt_default) {
      var index;
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        return id in hiddenRecord ? hiddenRecord[id] : opt_default;
      } else {
        index = keys.indexOf(key);
        return index >= 0 ? values[index] : opt_default;
      }
    }

    function has___(key) {
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        return id in hiddenRecord;
      } else {
        return keys.indexOf(key) >= 0;
      }
    }

    function set___(key, value) {
      var index;
      var hiddenRecord = getHiddenRecord(key);
      if (hiddenRecord) {
        hiddenRecord[id] = value;
      } else {
        index = keys.indexOf(key);
        if (index >= 0) {
          values[index] = value;
        } else {
          // Since some browsers preemptively terminate slow turns but
          // then continue computing with presumably corrupted heap
          // state, we here defensively get keys.length first and then
          // use it to update both the values and keys arrays, keeping
          // them in sync.
          index = keys.length;
          values[index] = value;
          // If we crash here, values will be one longer than keys.
          keys[index] = key;
        }
      }
      return this;
    }

    function delete___(key) {
      var hiddenRecord = getHiddenRecord(key);
      var index, lastIndex;
      if (hiddenRecord) {
        return id in hiddenRecord && delete hiddenRecord[id];
      } else {
        index = keys.indexOf(key);
        if (index < 0) {
          return false;
        }
        // Since some browsers preemptively terminate slow turns but
        // then continue computing with potentially corrupted heap
        // state, we here defensively get keys.length first and then use
        // it to update both the keys and the values array, keeping
        // them in sync. We update the two with an order of assignments,
        // such that any prefix of these assignments will preserve the
        // key/value correspondence, either before or after the delete.
        // Note that this needs to work correctly when index === lastIndex.
        lastIndex = keys.length - 1;
        keys[index] = void 0;
        // If we crash here, there's a void 0 in the keys array, but
        // no operation will cause a "keys.indexOf(void 0)", since
        // getHiddenRecord(void 0) will always throw an error first.
        values[index] = values[lastIndex];
        // If we crash here, values[index] cannot be found here,
        // because keys[index] is void 0.
        keys[index] = keys[lastIndex];
        // If index === lastIndex and we crash here, then keys[index]
        // is still void 0, since the aliasing killed the previous key.
        keys.length = lastIndex;
        // If we crash here, keys will be one shorter than values.
        values.length = lastIndex;
        return true;
      }
    }

    return Object.create(OurWeakMap.prototype, {
      get___:    { value: constFunc(get___) },
      has___:    { value: constFunc(has___) },
      set___:    { value: constFunc(set___) },
      delete___: { value: constFunc(delete___) }
    });
  };

  OurWeakMap.prototype = Object.create(Object.prototype, {
    get: {
      /**
       * Return the value most recently associated with key, or
       * opt_default if none.
       */
      value: function get(key, opt_default) {
        return this.get___(key, opt_default);
      },
      writable: true,
      configurable: true
    },

    has: {
      /**
       * Is there a value associated with key in this WeakMap?
       */
      value: function has(key) {
        return this.has___(key);
      },
      writable: true,
      configurable: true
    },

    set: {
      /**
       * Associate value with key in this WeakMap, overwriting any
       * previous association if present.
       */
      value: function set(key, value) {
        return this.set___(key, value);
      },
      writable: true,
      configurable: true
    },

    'delete': {
      /**
       * Remove any association for key in this WeakMap, returning
       * whether there was one.
       *
       * <p>Note that the boolean return here does not work like the
       * {@code delete} operator. The {@code delete} operator returns
       * whether the deletion succeeds at bringing about a state in
       * which the deleted property is absent. The {@code delete}
       * operator therefore returns true if the property was already
       * absent, whereas this {@code delete} method returns false if
       * the association was already absent.
       */
      value: function remove(key) {
        return this.delete___(key);
      },
      writable: true,
      configurable: true
    }
  });

  if (typeof HostWeakMap === 'function') {
    (function() {
      // If we got here, then the platform has a WeakMap but we are concerned
      // that it may refuse to store some key types. Therefore, make a map
      // implementation which makes use of both as possible.

      // In this mode we are always using double maps, so we are not proxy-safe.
      // This combination does not occur in any known browser, but we had best
      // be safe.
      if (doubleWeakMapCheckSilentFailure && typeof Proxy !== 'undefined') {
        Proxy = undefined;
      }

      function DoubleWeakMap() {
        if (!(this instanceof OurWeakMap)) {  // approximate test for new ...()
          calledAsFunctionWarning();
        }

        // Preferable, truly weak map.
        var hmap = new HostWeakMap();

        // Our hidden-property-based pseudo-weak-map. Lazily initialized in the
        // 'set' implementation; thus we can avoid performing extra lookups if
        // we know all entries actually stored are entered in 'hmap'.
        var omap = undefined;

        // Hidden-property maps are not compatible with proxies because proxies
        // can observe the hidden name and either accidentally expose it or fail
        // to allow the hidden property to be set. Therefore, we do not allow
        // arbitrary WeakMaps to switch to using hidden properties, but only
        // those which need the ability, and unprivileged code is not allowed
        // to set the flag.
        //
        // (Except in doubleWeakMapCheckSilentFailure mode in which case we
        // disable proxies.)
        var enableSwitching = false;

        function dget(key, opt_default) {
          if (omap) {
            return hmap.has(key) ? hmap.get(key)
                : omap.get___(key, opt_default);
          } else {
            return hmap.get(key, opt_default);
          }
        }

        function dhas(key) {
          return hmap.has(key) || (omap ? omap.has___(key) : false);
        }

        var dset;
        if (doubleWeakMapCheckSilentFailure) {
          dset = function(key, value) {
            hmap.set(key, value);
            if (!hmap.has(key)) {
              if (!omap) { omap = new OurWeakMap(); }
              omap.set(key, value);
            }
            return this;
          };
        } else {
          dset = function(key, value) {
            if (enableSwitching) {
              try {
                hmap.set(key, value);
              } catch (e) {
                if (!omap) { omap = new OurWeakMap(); }
                omap.set___(key, value);
              }
            } else {
              hmap.set(key, value);
            }
            return this;
          };
        }

        function ddelete(key) {
          var result = !!hmap['delete'](key);
          if (omap) { return omap.delete___(key) || result; }
          return result;
        }

        return Object.create(OurWeakMap.prototype, {
          get___:    { value: constFunc(dget) },
          has___:    { value: constFunc(dhas) },
          set___:    { value: constFunc(dset) },
          delete___: { value: constFunc(ddelete) },
          permitHostObjects___: { value: constFunc(function(token) {
            if (token === weakMapPermitHostObjects) {
              enableSwitching = true;
            } else {
              throw new Error('bogus call to permitHostObjects___');
            }
          })}
        });
      }
      DoubleWeakMap.prototype = OurWeakMap.prototype;
      module.exports = DoubleWeakMap;

      // define .constructor to hide OurWeakMap ctor
      Object.defineProperty(WeakMap.prototype, 'constructor', {
        value: WeakMap,
        enumerable: false,  // as default .constructor is
        configurable: true,
        writable: true
      });
    })();
  } else {
    // There is no host WeakMap, so we must use the emulation.

    // Emulated WeakMaps are incompatible with native proxies (because proxies
    // can observe the hidden name), so we must disable Proxy usage (in
    // ArrayLike and Domado, currently).
    if (typeof Proxy !== 'undefined') {
      Proxy = undefined;
    }

    module.exports = OurWeakMap;
  }
})();

},{}],12:[function(require,module,exports){
'use strict'

var weakMap = typeof WeakMap === 'undefined' ? require('weak-map') : WeakMap

var WebGLEWStruct = new weakMap()

function baseName(ext_name) {
  return ext_name.replace(/^[A-Z]+_/, '')
}

function initWebGLEW(gl) {
  var struct = WebGLEWStruct.get(gl)
  if(struct) {
    return struct
  }
  var extensions = {}
  var supported = gl.getSupportedExtensions()
  for(var i=0; i<supported.length; ++i) {
    var extName = supported[i]

    //Skip MOZ_ extensions
    if(extName.indexOf('MOZ_') === 0) {
      continue
    }
    var ext = gl.getExtension(supported[i])
    if(!ext) {
      continue
    }
    while(true) {
      extensions[extName] = ext
      var base = baseName(extName)
      if(base === extName) {
        break
      }
      extName = base
    }
  }
  WebGLEWStruct.set(gl, extensions)
  return extensions
}
module.exports = initWebGLEW
},{"weak-map":11}],13:[function(require,module,exports){
"use strict"

function doBind(gl, elements, attributes) {
  if(elements) {
    elements.bind()
  } else {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  }
  var nattribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS)|0
  if(attributes) {
    if(attributes.length > nattribs) {
      throw new Error("gl-vao: Too many vertex attributes")
    }
    for(var i=0; i<attributes.length; ++i) {
      var attrib = attributes[i]
      if(attrib.buffer) {
        var buffer = attrib.buffer
        var size = attrib.size || 4
        var type = attrib.type || gl.FLOAT
        var normalized = !!attrib.normalized
        var stride = attrib.stride || 0
        var offset = attrib.offset || 0
        buffer.bind()
        gl.enableVertexAttribArray(i)
        gl.vertexAttribPointer(i, size, type, normalized, stride, offset)
      } else {
        if(typeof attrib === "number") {
          gl.vertexAttrib1f(i, attrib)
        } else if(attrib.length === 1) {
          gl.vertexAttrib1f(i, attrib[0])
        } else if(attrib.length === 2) {
          gl.vertexAttrib2f(i, attrib[0], attrib[1])
        } else if(attrib.length === 3) {
          gl.vertexAttrib3f(i, attrib[0], attrib[1], attrib[2])
        } else if(attrib.length === 4) {
          gl.vertexAttrib4f(i, attrib[0], attrib[1], attrib[2], attrib[3])
        } else {
          throw new Error("gl-vao: Invalid vertex attribute")
        }
        gl.disableVertexAttribArray(i)
      }
    }
    for(; i<nattribs; ++i) {
      gl.disableVertexAttribArray(i)
    }
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    for(var i=0; i<nattribs; ++i) {
      gl.disableVertexAttribArray(i)
    }
  }
}

module.exports = doBind
},{}],14:[function(require,module,exports){
"use strict"

var bindAttribs = require("./do-bind.js")

function VAOEmulated(gl) {
  this.gl = gl
  this._elements = null
  this._attributes = null
  this._elementsType = gl.UNSIGNED_SHORT
}

VAOEmulated.prototype.bind = function() {
  bindAttribs(this.gl, this._elements, this._attributes)
}

VAOEmulated.prototype.update = function(attributes, elements, elementsType) {
  this._elements = elements
  this._attributes = attributes
  this._elementsType = elementsType || this.gl.UNSIGNED_SHORT
}

VAOEmulated.prototype.dispose = function() { }
VAOEmulated.prototype.unbind = function() { }

VAOEmulated.prototype.draw = function(mode, count, offset) {
  offset = offset || 0
  var gl = this.gl
  if(this._elements) {
    gl.drawElements(mode, count, this._elementsType, offset)
  } else {
    gl.drawArrays(mode, offset, count)
  }
}

function createVAOEmulated(gl) {
  return new VAOEmulated(gl)
}

module.exports = createVAOEmulated
},{"./do-bind.js":13}],15:[function(require,module,exports){
"use strict"

var bindAttribs = require("./do-bind.js")

function VertexAttribute(location, dimension, a, b, c, d) {
  this.location = location
  this.dimension = dimension
  this.a = a
  this.b = b
  this.c = c
  this.d = d
}

VertexAttribute.prototype.bind = function(gl) {
  switch(this.dimension) {
    case 1:
      gl.vertexAttrib1f(this.location, this.a)
    break
    case 2:
      gl.vertexAttrib2f(this.location, this.a, this.b)
    break
    case 3:
      gl.vertexAttrib3f(this.location, this.a, this.b, this.c)
    break
    case 4:
      gl.vertexAttrib4f(this.location, this.a, this.b, this.c, this.d)
    break
  }
}

function VAONative(gl, ext, handle) {
  this.gl = gl
  this._ext = ext
  this.handle = handle
  this._attribs = []
  this._useElements = false
  this._elementsType = gl.UNSIGNED_SHORT
}

VAONative.prototype.bind = function() {
  this._ext.bindVertexArrayOES(this.handle)
  for(var i=0; i<this._attribs.length; ++i) {
    this._attribs[i].bind(this.gl)
  }
}

VAONative.prototype.unbind = function() {
  this._ext.bindVertexArrayOES(null)
}

VAONative.prototype.dispose = function() {
  this._ext.deleteVertexArrayOES(this.handle)
}

VAONative.prototype.update = function(attributes, elements, elementsType) {
  this.bind()
  bindAttribs(this.gl, elements, attributes)
  this.unbind()
  this._attribs.length = 0
  if(attributes)
  for(var i=0; i<attributes.length; ++i) {
    var a = attributes[i]
    if(typeof a === "number") {
      this._attribs.push(new VertexAttribute(i, 1, a))
    } else if(Array.isArray(a)) {
      this._attribs.push(new VertexAttribute(i, a.length, a[0], a[1], a[2], a[3]))
    }
  }
  this._useElements = !!elements
  this._elementsType = elementsType || this.gl.UNSIGNED_SHORT
}

VAONative.prototype.draw = function(mode, count, offset) {
  offset = offset || 0
  var gl = this.gl
  if(this._useElements) {
    gl.drawElements(mode, count, this._elementsType, offset)
  } else {
    gl.drawArrays(mode, offset, count)
  }
}

function createVAONative(gl, ext) {
  return new VAONative(gl, ext, ext.createVertexArrayOES())
}

module.exports = createVAONative
},{"./do-bind.js":13}],16:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],17:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":16}],18:[function(require,module,exports){
"use strict"

var webglew = require("webglew")
var createVAONative = require("./lib/vao-native.js")
var createVAOEmulated = require("./lib/vao-emulated.js")

function createVAO(gl, attributes, elements, elementsType) {
  var ext = webglew(gl).OES_vertex_array_object
  var vao
  if(ext) {
    vao = createVAONative(gl, ext)
  } else {
    vao = createVAOEmulated(gl)
  }
  vao.update(attributes, elements, elementsType)
  return vao
}

module.exports = createVAO
},{"./lib/vao-emulated.js":14,"./lib/vao-native.js":15,"webglew":17}],19:[function(require,module,exports){
/* (The MIT License)
 *
 * Copyright (c) 2012 Brandon Benvie <http://bbenvie.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the 'Software'), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included with all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY  CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Original WeakMap implementation by Gozala @ https://gist.github.com/1269991
// Updated and bugfixed by Raynos @ https://gist.github.com/1638059
// Expanded by Benvie @ https://github.com/Benvie/harmony-collections

void function(global, undefined_, undefined){
  var getProps = Object.getOwnPropertyNames,
      defProp  = Object.defineProperty,
      toSource = Function.prototype.toString,
      create   = Object.create,
      hasOwn   = Object.prototype.hasOwnProperty,
      funcName = /^\n?function\s?(\w*)?_?\(/;


  function define(object, key, value){
    if (typeof key === 'function') {
      value = key;
      key = nameOf(value).replace(/_$/, '');
    }
    return defProp(object, key, { configurable: true, writable: true, value: value });
  }

  function nameOf(func){
    return typeof func !== 'function'
          ? '' : 'name' in func
          ? func.name : toSource.call(func).match(funcName)[1];
  }

  // ############
  // ### Data ###
  // ############

  var Data = (function(){
    var dataDesc = { value: { writable: true, value: undefined } },
        datalock = 'return function(k){if(k===s)return l}',
        uids     = create(null),

        createUID = function(){
          var key = Math.random().toString(36).slice(2);
          return key in uids ? createUID() : uids[key] = key;
        },

        globalID = createUID(),

        storage = function(obj){
          if (hasOwn.call(obj, globalID))
            return obj[globalID];

          if (!Object.isExtensible(obj))
            throw new TypeError("Object must be extensible");

          var store = create(null);
          defProp(obj, globalID, { value: store });
          return store;
        };

    // common per-object storage area made visible by patching getOwnPropertyNames'
    define(Object, function getOwnPropertyNames(obj){
      var props = getProps(obj);
      if (hasOwn.call(obj, globalID))
        props.splice(props.indexOf(globalID), 1);
      return props;
    });

    function Data(){
      var puid = createUID(),
          secret = {};

      this.unlock = function(obj){
        var store = storage(obj);
        if (hasOwn.call(store, puid))
          return store[puid](secret);

        var data = create(null, dataDesc);
        defProp(store, puid, {
          value: new Function('s', 'l', datalock)(secret, data)
        });
        return data;
      }
    }

    define(Data.prototype, function get(o){ return this.unlock(o).value });
    define(Data.prototype, function set(o, v){ this.unlock(o).value = v });

    return Data;
  }());


  var WM = (function(data){
    var validate = function(key){
      if (key == null || typeof key !== 'object' && typeof key !== 'function')
        throw new TypeError("Invalid WeakMap key");
    }

    var wrap = function(collection, value){
      var store = data.unlock(collection);
      if (store.value)
        throw new TypeError("Object is already a WeakMap");
      store.value = value;
    }

    var unwrap = function(collection){
      var storage = data.unlock(collection).value;
      if (!storage)
        throw new TypeError("WeakMap is not generic");
      return storage;
    }

    var initialize = function(weakmap, iterable){
      if (iterable !== null && typeof iterable === 'object' && typeof iterable.forEach === 'function') {
        iterable.forEach(function(item, i){
          if (item instanceof Array && item.length === 2)
            set.call(weakmap, iterable[i][0], iterable[i][1]);
        });
      }
    }


    function WeakMap(iterable){
      if (this === global || this == null || this === WeakMap.prototype)
        return new WeakMap(iterable);

      wrap(this, new Data);
      initialize(this, iterable);
    }

    function get(key){
      validate(key);
      var value = unwrap(this).get(key);
      return value === undefined_ ? undefined : value;
    }

    function set(key, value){
      validate(key);
      // store a token for explicit undefined so that "has" works correctly
      unwrap(this).set(key, value === undefined ? undefined_ : value);
    }

    function has(key){
      validate(key);
      return unwrap(this).get(key) !== undefined;
    }

    function delete_(key){
      validate(key);
      var data = unwrap(this),
          had = data.get(key) !== undefined;
      data.set(key, undefined);
      return had;
    }

    function toString(){
      unwrap(this);
      return '[object WeakMap]';
    }

    try {
      var src = ('return '+delete_).replace('e_', '\\u0065'),
          del = new Function('unwrap', 'validate', src)(unwrap, validate);
    } catch (e) {
      var del = delete_;
    }

    var src = (''+Object).split('Object');
    var stringifier = function toString(){
      return src[0] + nameOf(this) + src[1];
    };

    define(stringifier, stringifier);

    var prep = { __proto__: [] } instanceof Array
      ? function(f){ f.__proto__ = stringifier }
      : function(f){ define(f, stringifier) };

    prep(WeakMap);

    [toString, get, set, has, del].forEach(function(method){
      define(WeakMap.prototype, method);
      prep(method);
    });

    return WeakMap;
  }(new Data));

  var defaultCreator = Object.create
    ? function(){ return Object.create(null) }
    : function(){ return {} };

  function createStorage(creator){
    var weakmap = new WM;
    creator || (creator = defaultCreator);

    function storage(object, value){
      if (value || arguments.length === 2) {
        weakmap.set(object, value);
      } else {
        value = weakmap.get(object);
        if (value === undefined) {
          value = creator(object);
          weakmap.set(object, value);
        }
      }
      return value;
    }

    return storage;
  }


  if (typeof module !== 'undefined') {
    module.exports = WM;
  } else if (typeof exports !== 'undefined') {
    exports.WeakMap = WM;
  } else if (!('WeakMap' in global)) {
    global.WeakMap = WM;
  }

  WM.createStorage = createStorage;
  if (global.WeakMap)
    global.WeakMap.createStorage = createStorage;
}((0, eval)('this'));

},{}],20:[function(require,module,exports){
'use strict'

var weakMap      = typeof WeakMap === 'undefined' ? require('weakmap') : WeakMap
var createBuffer = require('gl-buffer')
var createVAO    = require('gl-vao')

var TriangleCache = new weakMap()

function createABigTriangle(gl) {

  var triangleVAO = TriangleCache.get(gl)
  if(!triangleVAO) {
    var buf = createBuffer(gl, new Float32Array([-1, -1, -1, 4, 4, -1]))
    triangleVAO = createVAO(gl, [
      { buffer: buf,
        type: gl.FLOAT,
        size: 2
      }
    ])
    TriangleCache.set(gl, triangleVAO)
  }
  triangleVAO.bind()
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  triangleVAO.unbind()
}

module.exports = createABigTriangle
},{"gl-buffer":2,"gl-vao":18,"weakmap":19}],21:[function(require,module,exports){
'use strict'

module.exports = createAxes

var createText        = require('./lib/text.js')
var createLines       = require('./lib/lines.js')
var createBackground  = require('./lib/background.js')
var getCubeProperties = require('./lib/cube.js')
var Ticks             = require('./lib/ticks.js')

var identity = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1])

function copyVec3(a, b) {
  a[0] = b[0]
  a[1] = b[1]
  a[2] = b[2]
  return a
}

function Axes(gl) {
  this.gl             = gl

  this.pixelRatio     = 1

  this.bounds         = [ [-10, -10, -10], 
                          [ 10,  10,  10] ]
  this.ticks          = [ [], [], [] ]
  this.autoTicks      = true
  this.tickSpacing    = [ 1, 1, 1 ]

  this.tickEnable     = [ true, true, true ]
  this.tickFont       = [ 'sans-serif', 'sans-serif', 'sans-serif' ]
  this.tickSize       = [ 12, 12, 12 ]
  this.tickAngle      = [ 0, 0, 0 ]
  this.tickColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]
  this.tickPad        = [ 0.05, 0.05, 0.05 ]

  this.lastCubeProps  = {
    cubeEdges: [0,0,0],
    axis:      [0,0,0]
  }

  this.labels         = [ 'x', 'y', 'z' ]
  this.labelEnable    = [ true, true, true ]
  this.labelFont      = 'sans-serif'
  this.labelSize      = [ 20, 20, 20 ]
  this.labelAngle     = [ 0, 0, 0 ]
  this.labelColor     = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]
  this.labelPad       = [ 0.05, 0.05, 0.05 ]

  this.lineEnable     = [ true, true, true ]
  this.lineMirror     = [ false, false, false ]
  this.lineWidth      = [ 1, 1, 1 ]
  this.lineColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]

  this.lineTickEnable = [ true, true, true ]
  this.lineTickMirror = [ false, false, false ]
  this.lineTickLength = [ 0, 0, 0 ]
  this.lineTickWidth  = [ 1, 1, 1 ]
  this.lineTickColor  = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]

  this.gridEnable     = [ true, true, true ]
  this.gridWidth      = [ 1, 1, 1 ]
  this.gridColor      = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]

  this.zeroEnable     = [ true, true, true ]
  this.zeroLineColor  = [ [0,0,0,1], [0,0,0,1], [0,0,0,1] ]
  this.zeroLineWidth  = [ 2, 2, 2 ]

  this.backgroundEnable = [ false, false, false ]
  this.backgroundColor  = [ [0.8, 0.8, 0.8, 0.5], 
                            [0.8, 0.8, 0.8, 0.5], 
                            [0.8, 0.8, 0.8, 0.5] ]

  this._firstInit = true
  this._text  = null
  this._lines = null
  this._background = createBackground(gl)
}

var proto = Axes.prototype

proto.update = function(options) {
  options = options || {}

  //Option parsing helper functions
  function parseOption(nest, cons, name) {
    if(name in options) {
      var opt = options[name]
      var prev = this[name]
      var next
      if(nest ? (Array.isArray(opt) && Array.isArray(opt[0])) :
                 Array.isArray(opt) ) {
        this[name] = next = [ cons(opt[0]), cons(opt[1]), cons(opt[2]) ]
      } else {
        this[name] = next = [ cons(opt), cons(opt), cons(opt) ]
      }
      for(var i=0; i<3; ++i) {
        if(next[i] !== prev[i]) {
          return true
        }
      }
    }
    return false
  }

  var NUMBER  = parseOption.bind(this, false, Number)
  var BOOLEAN = parseOption.bind(this, false, Boolean)
  var STRING  = parseOption.bind(this, false, String)
  var COLOR   = parseOption.bind(this, true, function(v) {
    if(Array.isArray(v)) {
      if(v.length === 3) {
        return [ +v[0], +v[1], +v[2], 1.0 ]
      } else if(v.length === 4) {
        return [ +v[0], +v[1], +v[2], +v[3] ]
      }
    }
    return [ 0, 0, 0, 1 ]
  })

  //Tick marks and bounds
  var nextTicks
  var ticksUpdate   = false
  var boundsChanged = false
  if('bounds' in options) {
    var bounds = options.bounds
i_loop:
    for(var i=0; i<2; ++i) {
      for(var j=0; j<3; ++j) {
        if(bounds[i][j] !== this.bounds[i][j]) {
          boundsChanged = true
        }
        this.bounds[i][j] = bounds[i][j]
      }
    }
  }
  if('ticks' in options) {
    nextTicks      = options.ticks
    ticksUpdate    = true
    this.autoTicks = false
    for(var i=0; i<3; ++i) {
      this.tickSpacing[i] = 0.0
    }
  } else if(NUMBER('tickSpacing')) {
    this.autoTicks  = true
    boundsChanged   = true
  }

  if(this._firstInit) {
    if(!('ticks' in options || 'tickSpacing' in options)) {
      this.autoTicks = true
    }

    //Force tick recomputation on first update
    boundsChanged   = true
    ticksUpdate     = true
    this._firstInit = false
  }

  if(boundsChanged && this.autoTicks) {
    nextTicks = Ticks.create(this.bounds, this.tickSpacing)
    ticksUpdate = true
  }

  //Compare next ticks to previous ticks, only update if needed
  if(ticksUpdate) {
    for(var i=0; i<3; ++i) {
      nextTicks[i].sort(function(a,b) {
        return a.x-b.x
      })
    }
    if(Ticks.equal(nextTicks, this.ticks)) {
      ticksUpdate = false
    } else {
      this.ticks = nextTicks
    }
  }

  //Parse tick properties
  BOOLEAN('tickEnable')
  if(STRING('tickFont')) {
    ticksUpdate = true  //If font changes, must rebuild vbo
  }
  NUMBER('tickSize')
  NUMBER('tickAngle')
  NUMBER('tickPad')
  COLOR('tickColor')

  //Axis labels
  var labelUpdate = STRING('labels')
  if(STRING('labelFont')) {
    labelUpdate = true
  }
  BOOLEAN('labelEnable')
  NUMBER('labelSize')
  NUMBER('labelPad')
  COLOR('labelColor')

  //Axis lines
  BOOLEAN('lineEnable')
  BOOLEAN('lineMirror')
  NUMBER('lineWidth')
  COLOR('lineColor')

  //Axis line ticks
  BOOLEAN('lineTickEnable')
  BOOLEAN('lineTickMirror')
  NUMBER('lineTickLength')
  NUMBER('lineTickWidth')
  COLOR('lineTickColor')

  //Grid lines
  BOOLEAN('gridEnable')
  NUMBER('gridWidth')
  COLOR('gridColor')

  //Zero line
  BOOLEAN('zeroEnable')
  COLOR('zeroLineColor')
  NUMBER('zeroLineWidth')

  //Background
  BOOLEAN('backgroundEnable')
  COLOR('backgroundColor')

  //Update text if necessary
  if(!this._text) {
    this._text = createText(
      this.gl, 
      this.bounds,
      this.labels,
      this.labelFont,
      this.ticks,
      this.tickFont)
  } else if(this._text && (labelUpdate || ticksUpdate)) {
    this._text.update(
      this.bounds,
      this.labels,
      this.labelFont,
      this.ticks,
      this.tickFont)
  }
  
  //Update lines if necessary
  if(this._lines && ticksUpdate) {
    this._lines.dispose()
    this._lines = null
  }
  if(!this._lines) {
    this._lines = createLines(this.gl, this.bounds, this.ticks)
  }
}

function OffsetInfo() {
  this.primalOffset = [0,0,0]
  this.primalMinor  = [0,0,0]
  this.mirrorOffset = [0,0,0]
  this.mirrorMinor  = [0,0,0]
}

var LINE_OFFSET = [ new OffsetInfo(), new OffsetInfo(), new OffsetInfo() ]

function computeLineOffset(result, i, bounds, cubeEdges, cubeAxis) {
  var primalOffset = result.primalOffset
  var primalMinor  = result.primalMinor
  var dualOffset   = result.mirrorOffset
  var dualMinor    = result.mirrorMinor
  var e = cubeEdges[i]

  //Calculate offsets
  for(var j=0; j<3; ++j) {
    if(i === j) {
      continue
    }
    var a = primalOffset, 
        b = dualOffset,
        c = primalMinor,
        d = dualMinor
    if(e & (1<<j)) {
      a = dualOffset
      b = primalOffset
      c = dualMinor
      d = primalMinor
    }
    a[j] = bounds[0][j]
    b[j] = bounds[1][j]
    if(cubeAxis[j] > 0) {
      c[j] = -1
      d[j] = 0
    } else {
      c[j] = 0
      d[j] = +1
    }
  }
}

var CUBE_ENABLE = [0,0,0]
var DEFAULT_PARAMS = {
  model:      identity,
  view:       identity,
  projection: identity
}

proto.isOpaque = function() {
  return true
}

proto.isTransparent = function() {
  return false
}

proto.drawTransparent = function(params) {}


var PRIMAL_MINOR  = [0,0,0]
var MIRROR_MINOR  = [0,0,0]
var PRIMAL_OFFSET = [0,0,0]

proto.draw = function(params) {
  params = params || DEFAULT_PARAMS

  //Geometry for camera and axes
  var model       = params.model || identity
  var view        = params.view || identity
  var projection  = params.projection || identity
  var bounds      = this.bounds

  //Unpack axis info
  var cubeParams  = getCubeProperties(model, view, projection, bounds)
  var cubeEdges   = cubeParams.cubeEdges
  var cubeAxis    = cubeParams.axis

  for(var i=0; i<3; ++i) {
    this.lastCubeProps.cubeEdges[i] = cubeEdges[i]
    this.lastCubeProps.axis[i] = cubeAxis[i]
  }

  //Compute axis info
  var lineOffset  = LINE_OFFSET
  for(var i=0; i<3; ++i) {
    computeLineOffset(
      LINE_OFFSET[i], 
      i, 
      this.bounds, 
      cubeEdges, 
      cubeAxis)
  }

  //Set up state parameters
  var gl = this.gl

  //Draw background first
  var cubeEnable = CUBE_ENABLE
  for(var i=0; i<3; ++i) {
    if(this.backgroundEnable[i]) {
      cubeEnable[i] = cubeAxis[i]
    } else {
      cubeEnable[i] = 0
    }
  }

  this._background.draw(
    model, 
    view, 
    projection, 
    bounds, 
    cubeEnable,
    this.backgroundColor)

  //Draw lines
  this._lines.bind(
    model,
    view,
    projection,
    this)

  //First draw grid lines and zero lines
  for(var i=0; i<3; ++i) {
    var x = [0,0,0]
    if(cubeAxis[i] > 0) {
      x[i] = bounds[1][i]
    } else {
      x[i] = bounds[0][i]
    }

    //Draw grid lines
    for(var j=0; j<2; ++j) {
      var u = (i + 1 + j) % 3
      var v = (i + 1 + (j^1)) % 3
      if(this.gridEnable[u]) {
        gl.lineWidth(this.gridWidth[u])
        this._lines.drawGrid(u, v, this.bounds, x, this.gridColor[u])
      }
    }

    //Draw zero lines (need to do this AFTER all grid lines are drawn)
    for(var j=0; j<2; ++j) {
      var u = (i + 1 + j) % 3
      var v = (i + 1 + (j^1)) % 3
      if(this.zeroEnable[v]) {
        //Check if zero line in bounds
        if(bounds[0][v] <= 0 && bounds[1][v] >= 0) {
          gl.lineWidth(this.zeroLineWidth[v])
          this._lines.drawZero(u, this.bounds, x, this.zeroLineColor[v])
        }
      }
    }
  }

  //Then draw axis lines and tick marks
  for(var i=0; i<3; ++i) {

    //Draw axis lines
    gl.lineWidth(this.lineWidth[i])
    if(this.lineEnable[i]) {
      this._lines.drawAxisLine(i, this.bounds, lineOffset[i].primalOffset, this.lineColor[i])
    }
    if(this.lineMirror[i]) {
      this._lines.drawAxisLine(i, this.bounds, lineOffset[i].mirrorOffset, this.lineColor[i])
    }

    //Compute minor axes
    var primalMinor = copyVec3(PRIMAL_MINOR, lineOffset[i].primalMinor)
    var mirrorMinor = copyVec3(MIRROR_MINOR, lineOffset[i].mirrorMinor)
    var tickLength  = this.lineTickLength
    for(var j=0; j<3; ++j) {
      var scaleFactor = 1.0 / model[5*j]
      primalMinor[j] *= tickLength[j] * scaleFactor
      mirrorMinor[j] *= tickLength[j] * scaleFactor
    }

    //Draw axis line ticks
    gl.lineWidth(this.lineTickWidth[i])
    if(this.lineTickEnable[i]) {
      this._lines.drawAxisTicks(i, lineOffset[i].primalOffset, primalMinor, this.lineTickColor[i])
    }
    if(this.lineTickMirror[i]) {
      this._lines.drawAxisTicks(i, lineOffset[i].mirrorOffset, mirrorMinor, this.lineTickColor[i])
    }
  }

  //Draw text sprites
  this._text.bind(
    model,
    view,
    projection,
    this.pixelRatio)

  for(var i=0; i<3; ++i) {

    var minor      = lineOffset[i].primalMinor
    var offset     = copyVec3(PRIMAL_OFFSET, lineOffset[i].primalOffset)

    for(var j=0; j<3; ++j) {
      if(this.lineTickEnable[i]) {
        offset[j] += minor[j] * Math.max(this.lineTickLength[j], 0)
      }
    }

    //Draw tick text
    if(this.tickEnable[i]) {
      
      //Add tick padding
      for(var j=0; j<3; ++j) {
        offset[j] += minor[j] * this.tickPad[j] / model[5*j]
      }

      //Draw axis
      this._text.drawTicks(
        i, 
        this.tickSize[i], 
        this.tickAngle[i],
        offset,
        this.tickColor[i])
    }

    //Draw labels
    if(this.labelEnable[i]) {

      //Add label padding
      for(var j=0; j<3; ++j) {
        offset[j] += minor[j] * this.labelPad[j] / model[5*j]
      }
      offset[i] += 0.5 * (bounds[0][i] + bounds[1][i])

      //Draw axis
      this._text.drawLabel(
        i, 
        this.labelSize[i], 
        this.labelAngle[i],
        offset,
        this.labelColor[i])
    }
  }
}

proto.dispose = function() {
  this._text.dispose()
  this._lines.dispose()
  this._background.dispose()
}

function createAxes(gl, options) {
  var axes = new Axes(gl)
  axes.update(options)
  return axes
}
},{"./lib/background.js":22,"./lib/cube.js":23,"./lib/lines.js":24,"./lib/text.js":25,"./lib/ticks.js":26}],22:[function(require,module,exports){
"use strict";
module.exports = createBackgroundCube;
var createBuffer = require("gl-buffer");
var createVAO = require("gl-vao");
var glslify = require("glslify");
var createShader = require("glslify/adapter.js")("\n#define GLSLIFY 1\n\nattribute vec3 position;\nattribute vec3 normal;\nuniform mat4 model, view, projection;\nuniform vec3 enable;\nuniform vec3 bounds[2];\nvarying vec3 colorChannel;\nvoid main() {\n  if(dot(normal, enable) > 0.0) {\n    vec3 nPosition = mix(bounds[0], bounds[1], 0.5 * (position + 1.0));\n    gl_Position = projection * view * model * vec4(nPosition, 1.0);\n  } else {\n    gl_Position = vec4(0, 0, 0, 0);\n  }\n  colorChannel = abs(normal);\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform vec4 colors[3];\nvarying vec3 colorChannel;\nvoid main() {\n  gl_FragColor = colorChannel.x * colors[0] + colorChannel.y * colors[1] + colorChannel.z * colors[2];\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"enable","type":"vec3"},{"name":"bounds[0]","type":"vec3"},{"name":"bounds[1]","type":"vec3"},{"name":"colors[0]","type":"vec4"},{"name":"colors[1]","type":"vec4"},{"name":"colors[2]","type":"vec4"}], [{"name":"position","type":"vec3"},{"name":"normal","type":"vec3"}]);

function BackgroundCube(gl, buffer, vao, shader) {
    this.gl = gl;
    this.buffer = buffer;
    this.vao = vao;
    this.shader = shader;
}

var proto = BackgroundCube.prototype;

proto.draw = function(model, view, projection, bounds, enable, colors) {
    var needsBG = false;

    for (var i = 0; i < 3; ++i) {
        needsBG = needsBG || enable[i];
    }

    if (!needsBG) {
        return;
    }

    var gl = this.gl;
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 2);
    this.shader.bind();

    this.shader.uniforms = {
        model: model,
        view: view,
        projection: projection,
        bounds: bounds,
        enable: enable,
        colors: colors
    };

    this.vao.bind();
    this.vao.draw(this.gl.TRIANGLES, 36);
    gl.disable(gl.POLYGON_OFFSET_FILL);
};

proto.dispose = function() {
    this.vao.dispose();
    this.buffer.dispose();
    this.shader.dispose();
};

function createBackgroundCube(gl) {
    var vertices = [];
    var indices = [];
    var ptr = 0;

    for (var d = 0; d < 3; ++d) {
        var u = (d + 1) % 3;
        var v = (d + 2) % 3;
        var x = [0, 0, 0];
        var c = [0, 0, 0];

        for (var s = -1; s <= 1; s += 2) {
            indices.push(ptr, ptr + 2, ptr + 1, ptr + 1, ptr + 2, ptr + 3);
            x[d] = s;
            c[d] = s;

            for (var i = -1; i <= 1; i += 2) {
                x[u] = i;

                for (var j = -1; j <= 1; j += 2) {
                    x[v] = j;
                    vertices.push(x[0], x[1], x[2], c[0], c[1], c[2]);
                    ptr += 1;
                }
            }

            var tt = u;
            u = v;
            v = tt;
        }
    }

    var buffer = createBuffer(gl, new Float32Array(vertices));
    var elements = createBuffer(gl, new Uint16Array(indices), gl.ELEMENT_ARRAY_BUFFER);

    var vao = createVAO(gl, [{
        buffer: buffer,
        type: gl.FLOAT,
        size: 3,
        offset: 0,
        stride: 24
    }, {
        buffer: buffer,
        type: gl.FLOAT,
        size: 3,
        offset: 12,
        stride: 24
    }], elements);

    var shader = createShader(gl);
    shader.attributes.position.location = 0;
    shader.attributes.normal.location = 1;
    return new BackgroundCube(gl, buffer, vao, shader);
}
},{"gl-buffer":30,"gl-vao":45,"glslify":164,"glslify/adapter.js":163}],23:[function(require,module,exports){
"use strict"

module.exports = getCubeEdges

var bits      = require('bit-twiddle')
var multiply  = require('gl-mat4/multiply')
var invert    = require('gl-mat4/invert')
var splitPoly = require('split-polygon')
var orient    = require('robust-orientation')

var mvp        = new Array(16)
var imvp       = new Array(16)
var pCubeVerts = new Array(8)
var cubeVerts  = new Array(8)
var x          = new Array(3)
var zero3      = [0,0,0]

;(function() {
  for(var i=0; i<8; ++i) {
    pCubeVerts[i] =[1,1,1,1]
    cubeVerts[i] = [1,1,1]
  }
})()


function transformHg(result, x, mat) {
  for(var i=0; i<4; ++i) {
    result[i] = mat[12+i]
    for(var j=0; j<3; ++j) {
      result[i] += x[j]*mat[4*j+i]
    }
  }
}

var FRUSTUM_PLANES = [
  [ 0, 0, 1, 0, 0],
  [ 0, 0,-1, 1, 0],
  [ 0,-1, 0, 1, 0],
  [ 0, 1, 0, 1, 0],
  [-1, 0, 0, 1, 0],
  [ 1, 0, 0, 1, 0]
]

function polygonArea(p) {
  for(var i=0; i<FRUSTUM_PLANES.length; ++i) {
    p = splitPoly.positive(p, FRUSTUM_PLANES[i])
    if(p.length < 3) {
      return 0
    }
  }

  var base = p[0]
  var ax = base[0] / base[3]
  var ay = base[1] / base[3]
  var area = 0.0
  for(var i=1; i+1<p.length; ++i) {
    var b = p[i]
    var c = p[i+1]

    var bx = b[0]/b[3]
    var by = b[1]/b[3]
    var cx = c[0]/c[3]
    var cy = c[1]/c[3]

    var ux = bx - ax
    var uy = by - ay

    var vx = cx - ax
    var vy = cy - ay

    area += Math.abs(ux * vy - uy * vx)
  }

  return area
}

var CUBE_EDGES = [1,1,1]
var CUBE_AXIS  = [0,0,0]
var CUBE_RESULT = {
  cubeEdges: CUBE_EDGES,
  axis: CUBE_AXIS
}

function getCubeEdges(model, view, projection, bounds) {

  //Concatenate matrices
  multiply(mvp, view, model)
  multiply(mvp, projection, mvp)
  
  //First project cube vertices
  var ptr = 0
  for(var i=0; i<2; ++i) {
    x[2] = bounds[i][2]
    for(var j=0; j<2; ++j) {
      x[1] = bounds[j][1]
      for(var k=0; k<2; ++k) {
        x[0] = bounds[k][0]
        transformHg(pCubeVerts[ptr], x, mvp)
        ptr += 1
      }
    }
  }

  //Classify camera against cube faces
  var closest = -1

  for(var i=0; i<8; ++i) {
    var w = pCubeVerts[i][3]
    for(var l=0; l<3; ++l) {
      cubeVerts[i][l] = pCubeVerts[i][l] / w
    }
    if(w < 0) {
      if(closest < 0) {
        closest = i
      } else if(cubeVerts[i][2] < cubeVerts[closest][2]) {
        closest = i
      }
    }    
  }

  if(closest < 0) {
    closest = 0
    for(var d=0; d<3; ++d) {
      var u = (d+2) % 3
      var v = (d+1) % 3
      var o0 = -1
      var o1 = -1
      for(var s=0; s<2; ++s) {
        var f0 = (s<<d)
        var f1 = f0 + (s << u) + ((1-s) << v)
        var f2 = f0 + ((1-s) << u) + (s << v)
        if(orient(cubeVerts[f0], cubeVerts[f1], cubeVerts[f2], zero3) < 0) {
          continue
        }
        if(s) {
          o0 = 1
        } else {
          o1 = 1
        }
      }
      if(o0 < 0 || o1 < 0) {
        if(o1 > o0) {
          closest |= 1<<d
        }
        continue
      } 
      for(var s=0; s<2; ++s) {
        var f0 = (s<<d)
        var f1 = f0 + (s << u) + ((1-s) << v)
        var f2 = f0 + ((1-s) << u) + (s << v)    
        var o = polygonArea([
            pCubeVerts[f0], 
            pCubeVerts[f1], 
            pCubeVerts[f2], 
            pCubeVerts[f0+(1<<u)+(1<<v)]])
        if(s) {
          o0 = o
        } else {
          o1 = o
        }
      }
      if(o1 > o0) {
        closest |= 1<<d
        continue
      }
    }
  }

  var farthest = 7^closest

  //Find lowest vertex which is not closest closest
  var bottom = -1
  for(var i=0; i<8; ++i) {
    if(i === closest || i === farthest) {
      continue
    }
    if(bottom < 0) {
      bottom = i
    } else if(cubeVerts[bottom][1] > cubeVerts[i][1]) {
      bottom = i
    }
  }

  //Find left/right neighbors of bottom vertex
  var left = -1
  for(var i=0; i<3; ++i) {
    var idx = bottom ^ (1<<i)
    if(idx === closest || idx === farthest) {
      continue
    }
    if(left < 0) {
      left = idx
    }
    var v = cubeVerts[idx]
    if(v[0] < cubeVerts[left][0]) {
      left = idx
    }
  }
  var right = -1
  for(var i=0; i<3; ++i) {
    var idx = bottom ^ (1<<i)
    if(idx === closest || idx === farthest || idx === left) {
      continue
    }
    if(right < 0) {
      right = idx
    }
    var v = cubeVerts[idx]
    if(v[0] > cubeVerts[right][0]) {
      right = idx
    }
  }

  //Determine edge axis coordinates
  var cubeEdges = CUBE_EDGES
  cubeEdges[0] = cubeEdges[1] = cubeEdges[2] = 0
  cubeEdges[bits.log2(left^bottom)] = bottom&left
  cubeEdges[bits.log2(bottom^right)] = bottom&right
  var top = right ^ 7
  if(top === closest || top === farthest) {
    top = left ^ 7
    cubeEdges[bits.log2(right^top)] = top&right
  } else {
    cubeEdges[bits.log2(left^top)] = top&left
  }

  //Determine visible faces
  var axis = CUBE_AXIS
  var cutCorner = closest
  for(var d=0; d<3; ++d) {
    if(cutCorner & (1<<d)) {
      axis[d] = -1
    } else {
      axis[d] = 1
    }
  }

  //Return result
  return CUBE_RESULT
}
},{"bit-twiddle":27,"gl-mat4/invert":123,"gl-mat4/multiply":125,"robust-orientation":51,"split-polygon":52}],24:[function(require,module,exports){
"use strict";
module.exports = createLines;
var createBuffer = require("gl-buffer");
var createVAO = require("gl-vao");
var glslify = require("glslify");
var createShader = require("glslify/adapter.js")("\n#define GLSLIFY 1\n\nattribute vec2 position;\nuniform mat4 model, view, projection;\nuniform vec3 offset, majorAxis, minorAxis;\nvoid main() {\n  vec3 vPosition = position.x * majorAxis + position.y * minorAxis + offset;\n  gl_Position = projection * view * model * vec4(vPosition, 1.0);\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform vec4 color;\nvoid main() {\n  gl_FragColor = color;\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"offset","type":"vec3"},{"name":"majorAxis","type":"vec3"},{"name":"minorAxis","type":"vec3"},{"name":"color","type":"vec4"}], [{"name":"position","type":"vec2"}]);
var MAJOR_AXIS = [0, 0, 0];
var MINOR_AXIS = [0, 0, 0];
var OFFSET_VEC = [0, 0, 0];

function zeroVec(a) {
    a[0] = a[1] = a[2] = 0;
    return a;
}

function copyVec(a, b) {
    a[0] = b[0];
    a[1] = b[1];
    a[2] = b[2];
    return a;
}

function Lines(gl, vertBuffer, vao, shader, tickCount, tickOffset, gridCount, gridOffset) {
    this.gl = gl;
    this.vertBuffer = vertBuffer;
    this.vao = vao;
    this.shader = shader;
    this.tickCount = tickCount;
    this.tickOffset = tickOffset;
    this.gridCount = gridCount;
    this.gridOffset = gridOffset;
}

var proto = Lines.prototype;

proto.bind = function(model, view, projection) {
    this.shader.bind();
    this.shader.uniforms.model = model;
    this.shader.uniforms.view = view;
    this.shader.uniforms.projection = projection;
    this.vao.bind();
};

proto.drawAxisLine = function(j, bounds, offset, color) {
    var minorAxis = zeroVec(MINOR_AXIS);
    this.shader.uniforms.majorAxis = MINOR_AXIS;
    minorAxis[j] = bounds[1][j] - bounds[0][j];
    this.shader.uniforms.minorAxis = minorAxis;
    var noffset = copyVec(OFFSET_VEC, offset);
    noffset[j] += bounds[0][j];
    this.shader.uniforms.offset = noffset;
    this.shader.uniforms.color = color;
    this.vao.draw(this.gl.LINES, 2);
};

proto.drawAxisTicks = function(j, offset, minorAxis, color) {
    var majorAxis = zeroVec(MAJOR_AXIS);
    majorAxis[j] = 1;
    this.shader.uniforms.majorAxis = majorAxis;
    this.shader.uniforms.offset = offset;
    this.shader.uniforms.minorAxis = minorAxis;
    this.shader.uniforms.color = color;
    this.vao.draw(this.gl.LINES, this.tickCount[j], this.tickOffset[j]);
};

proto.drawGrid = function(i, j, bounds, offset, color) {
    var minorAxis = zeroVec(MINOR_AXIS);
    minorAxis[j] = bounds[1][j] - bounds[0][j];
    this.shader.uniforms.minorAxis = minorAxis;
    var noffset = copyVec(OFFSET_VEC, offset);
    noffset[j] += bounds[0][j];
    this.shader.uniforms.offset = noffset;
    var majorAxis = zeroVec(MAJOR_AXIS);
    majorAxis[i] = 1;
    this.shader.uniforms.majorAxis = majorAxis;
    this.shader.uniforms.color = color;
    this.vao.draw(this.gl.LINES, this.gridCount[i], this.gridOffset[i]);
};

proto.drawZero = function(j, bounds, offset, color) {
    var minorAxis = zeroVec(MINOR_AXIS);
    this.shader.uniforms.majorAxis = minorAxis;
    minorAxis[j] = bounds[1][j] - bounds[0][j];
    this.shader.uniforms.minorAxis = minorAxis;
    var noffset = copyVec(OFFSET_VEC, offset);
    noffset[j] += bounds[0][j];
    this.shader.uniforms.offset = noffset;
    this.shader.uniforms.color = color;
    this.vao.draw(this.gl.LINES, 2);
};

proto.dispose = function() {
    this.vao.dispose();
    this.vertBuffer.dispose();
    this.shader.dispose();
};

function createLines(gl, bounds, ticks) {
    var vertices = [];
    var tickOffset = [0, 0, 0];
    var tickCount = [0, 0, 0];
    var gridOffset = [0, 0, 0];
    var gridCount = [0, 0, 0];
    vertices.push(0, 0, 0, 1);

    for (var i = 0; i < 3; ++i) {
        var start = vertices.length / 2 | 0;

        for (var j = 0; j < ticks[i].length; ++j) {
            vertices.push(+ticks[i][j].x, 0, +ticks[i][j].x, 1);
        }

        var end = vertices.length / 2 | 0;
        tickOffset[i] = start;
        tickCount[i] = end - start;
        var start = vertices.length / 2 | 0;

        for (var k = 0; k < ticks[i].length; ++k) {
            var tx = +ticks[i][k].x;
            vertices.push(tx, 0, tx, 1);
        }

        var end = vertices.length / 2 | 0;
        gridOffset[i] = start;
        gridCount[i] = end - start;
    }

    var vertBuf = createBuffer(gl, new Float32Array(vertices));

    var vao = createVAO(gl, [{
        "buffer": vertBuf,
        "type": gl.FLOAT,
        "size": 2,
        "stride": 0,
        "offset": 0
    }]);

    var shader = createShader(gl);
    shader.attributes.position.location = 0;
    return new Lines(gl, vertBuf, vao, shader, tickCount, tickOffset, gridCount, gridOffset);
}
},{"gl-buffer":30,"gl-vao":45,"glslify":164,"glslify/adapter.js":163}],25:[function(require,module,exports){
(function (process){
"use strict";
module.exports = createTextSprites;
var createBuffer = require("gl-buffer");
var createVAO = require("gl-vao");
var vectorizeText = require("vectorize-text");
var glslify = require("glslify");
var globals = window || process.global || {};
var __TEXT_CACHE = globals.__TEXT_CACHE || {};
globals.__TEXT_CACHE = {};
var createShader = require("glslify/adapter.js")("\n#define GLSLIFY 1\n\nattribute vec3 position;\nuniform mat4 model, view, projection;\nuniform vec3 offset, axis;\nuniform float scale, angle, pixelScale;\nuniform vec2 resolution;\nvoid main() {\n  vec2 planeCoord = position.xy * pixelScale;\n  mat2 planeXform = scale * mat2(cos(angle), sin(angle), -sin(angle), cos(angle));\n  vec2 viewOffset = 2.0 * planeXform * planeCoord / resolution;\n  float axisDistance = position.z;\n  vec3 dataPosition = axisDistance * axis + offset;\n  vec4 worldPosition = model * vec4(dataPosition, 1);\n  vec4 viewPosition = view * worldPosition;\n  vec4 clipPosition = projection * viewPosition;\n  clipPosition /= clipPosition.w;\n  clipPosition += vec4(viewOffset, 0, 0);\n  gl_Position = clipPosition;\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform vec4 color;\nvoid main() {\n  gl_FragColor = color;\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"offset","type":"vec3"},{"name":"axis","type":"vec3"},{"name":"scale","type":"float"},{"name":"angle","type":"float"},{"name":"pixelScale","type":"float"},{"name":"resolution","type":"vec2"},{"name":"color","type":"vec4"}], [{"name":"position","type":"vec3"}]);
var VERTEX_SIZE = 3;
var VERTEX_STRIDE = VERTEX_SIZE * 4;

function TextSprites(gl, shader, buffer, vao) {
    this.gl = gl;
    this.shader = shader;
    this.buffer = buffer;
    this.vao = vao;
    this.tickOffset = this.tickCount = this.labelOffset = this.labelCount = null;
}

var proto = TextSprites.prototype;
var SHAPE = [0, 0];

proto.bind = function(model, view, projection, pixelScale) {
    this.vao.bind();
    this.shader.bind();
    var uniforms = this.shader.uniforms;
    uniforms.model = model;
    uniforms.view = view;
    uniforms.projection = projection;
    uniforms.pixelScale = pixelScale;
    SHAPE[0] = this.gl.drawingBufferWidth;
    SHAPE[1] = this.gl.drawingBufferHeight;
    this.shader.uniforms.resolution = SHAPE;
};

proto.update = function(bounds, labels, labelFont, ticks, tickFont) {
    var gl = this.gl;
    var data = [];

    function addItem(t, text, font) {
        var fontcache = __TEXT_CACHE[font];

        if (!fontcache) {
            fontcache = __TEXT_CACHE[font] = {};
        }

        var mesh = fontcache[text];

        if (!mesh) {
            mesh = fontcache[text] = tryVectorizeText(text, {
                triangles: true,
                font: font,
                textAlign: "center",
                textBaseline: "middle"
            });
        }

        var positions = mesh.positions;
        var cells = mesh.cells;
        var lo = [Infinity, Infinity];
        var hi = [-Infinity, -Infinity];

        for (var i = 0, nc = cells.length; i < nc; ++i) {
            var c = cells[i];

            for (var j = 2; j >= 0; --j) {
                var p = positions[c[j]];
                data.push(p[0], -p[1], t);
            }
        }
    }

    var tickOffset = [0, 0, 0];
    var tickCount = [0, 0, 0];
    var labelOffset = [0, 0, 0];
    var labelCount = [0, 0, 0];

    for (var d = 0; d < 3; ++d) {
        labelOffset[d] = data.length / VERTEX_SIZE | 0;
        addItem(0.5 * (bounds[0][d] + bounds[1][d]), labels[d], labelFont);
        labelCount[d] = (data.length / VERTEX_SIZE | 0) - labelOffset[d];
        tickOffset[d] = data.length / VERTEX_SIZE | 0;

        for (var i = 0; i < ticks[d].length; ++i) {
            if (!ticks[d][i].text) {
                continue;
            }

            addItem(ticks[d][i].x, ticks[d][i].text, tickFont);
        }

        tickCount[d] = (data.length / VERTEX_SIZE | 0) - tickOffset[d];
    }

    this.buffer.update(data);
    this.tickOffset = tickOffset;
    this.tickCount = tickCount;
    this.labelOffset = labelOffset;
    this.labelCount = labelCount;
};

var AXIS = [0, 0, 0];

proto.drawTicks = function(d, scale, angle, offset, color) {
    var v = AXIS;
    v[0] = v[1] = v[2] = 0;
    v[d] = 1;
    this.shader.uniforms.axis = v;
    this.shader.uniforms.color = color;
    this.shader.uniforms.angle = angle;
    this.shader.uniforms.scale = scale;
    this.shader.uniforms.offset = offset;
    this.vao.draw(this.gl.TRIANGLES, this.tickCount[d], this.tickOffset[d]);
};

var ZERO = [0, 0, 0];

proto.drawLabel = function(d, scale, angle, offset, color) {
    this.shader.uniforms.axis = ZERO;
    this.shader.uniforms.color = color;
    this.shader.uniforms.angle = angle;
    this.shader.uniforms.scale = scale;
    this.shader.uniforms.offset = offset;
    this.vao.draw(this.gl.TRIANGLES, this.labelCount[d], this.labelOffset[d]);
};

proto.dispose = function() {
    this.shader.dispose();
    this.vao.dispose();
    this.buffer.dispose();
};

function tryVectorizeText(text, options) {
    try {
        return vectorizeText(text, options);
    } catch (e) {
        console.warn("error vectorizing text:", e);

        return {
            cells: [],
            positions: []
        };
    }
}

function createTextSprites(gl, bounds, labels, labelFont, ticks, tickFont) {
    var buffer = createBuffer(gl);

    var vao = createVAO(gl, [{
        "buffer": buffer,
        "size": 3
    }]);

    var shader = createShader(gl);
    shader.attributes.position.location = 0;
    var result = new TextSprites(gl, shader, buffer, vao);
    result.update(bounds, labels, labelFont, ticks, tickFont);
    return result;
}
}).call(this,require('_process'))
},{"_process":254,"gl-buffer":30,"gl-vao":45,"glslify":164,"glslify/adapter.js":163,"vectorize-text":56}],26:[function(require,module,exports){
'use strict'

exports.create   = defaultTicks
exports.equal    = ticksEqual

function prettyPrint(spacing, i) {
  var stepStr = spacing + ""
  var u = stepStr.indexOf(".")
  var sigFigs = 0
  if(u >= 0) {
    sigFigs = stepStr.length - u - 1
  }
  var shift = Math.pow(10, sigFigs)
  var x = Math.round(spacing * i * shift)
  var xstr = x + ""
  if(xstr.indexOf("e") >= 0) {
    return xstr
  }
  var xi = x / shift, xf = x % shift
  if(x < 0) {
    xi = -Math.ceil(xi)|0
    xf = (-xf)|0
  } else {
    xi = Math.floor(xi)|0
    xf = xf|0
  }
  var xis = "" + xi 
  if(x < 0) {
    xis = "-" + xis
  }
  if(sigFigs) {
    var xs = "" + xf
    while(xs.length < sigFigs) {
      xs = "0" + xs
    }
    return xis + "." + xs
  } else {
    return xis
  }
}

function defaultTicks(bounds, tickSpacing) {
  var array = []
  for(var d=0; d<3; ++d) {
    var ticks = []
    var m = 0.5*(bounds[0][d]+bounds[1][d])
    for(var t=0; t*tickSpacing[d]<=bounds[1][d]; ++t) {
      ticks.push({x: t*tickSpacing[d], text: prettyPrint(tickSpacing[d], t)})
    }
    for(var t=-1; t*tickSpacing[d]>=bounds[0][d]; --t) {
      ticks.push({x: t*tickSpacing[d], text: prettyPrint(tickSpacing[d], t)})
    }
    array.push(ticks)
  }
  return array
}

function ticksEqual(ticksA, ticksB) {
  for(var i=0; i<3; ++i) {
    if(ticksA[i].length !== ticksB[i].length) {
      return false
    }
    for(var j=0; j<ticksA[i].length; ++j) {
      var a = ticksA[i][j]
      var b = ticksB[i][j]
      if(a.x !== b.x || a.text !== b.text) {
        return false
      }
    }
  }
  return true
}
},{}],27:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],28:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],29:[function(require,module,exports){
"use strict"

module.exports = extractPlanes

function extractPlanes(M, zNear, zFar) {
  var z  = zNear || 0.0
  var zf = zFar || 1.0
  return [
    [ M[12] + M[0], M[13] + M[1], M[14] + M[2], M[15] + M[3] ],
    [ M[12] - M[0], M[13] - M[1], M[14] - M[2], M[15] - M[3] ],
    [ M[12] + M[4], M[13] + M[5], M[14] + M[6], M[15] + M[7] ],
    [ M[12] - M[4], M[13] - M[5], M[14] - M[6], M[15] - M[7] ],
    [ z*M[12] + M[8], z*M[13] + M[9], z*M[14] + M[10], z*M[15] + M[11] ],
    [ zf*M[12] - M[8], zf*M[13] - M[9], zf*M[14] - M[10], zf*M[15] - M[11] ]
  ]
}
},{}],30:[function(require,module,exports){
arguments[4][2][0].apply(exports,arguments)
},{"dup":2,"ndarray":247,"ndarray-ops":31,"typedarray-pool":36,"webglew":38}],31:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"cwise-compiler":32,"dup":3}],32:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":34,"dup":4}],33:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":35}],34:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":33,"dup":6}],35:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],36:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":27,"buffer":250,"dup":10}],37:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],38:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":37}],39:[function(require,module,exports){
/**
 * @fileoverview gl-matrix - High performance matrix and vector operations
 * @author Brandon Jones
 * @author Colin MacKenzie IV
 * @version 2.1.0
 */

/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */


(function() {
  "use strict";

  var shim = {};
  if (typeof(exports) === 'undefined') {
    if(typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
      shim.exports = {};
      define(function() {
        return shim.exports;
      });
    } else {
      // gl-matrix lives in a browser, define its namespaces in global
      shim.exports = window;
    }    
  }
  else {
    // gl-matrix lives in commonjs, define its namespaces in exports
    shim.exports = exports;
  }

  (function(exports) {
    /* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */


if(!GLMAT_EPSILON) {
    var GLMAT_EPSILON = 0.000001;
}

if(!GLMAT_ARRAY_TYPE) {
    var GLMAT_ARRAY_TYPE = (typeof Float32Array !== 'undefined') ? Float32Array : Array;
}

/**
 * @class Common utilities
 * @name glMatrix
 */
var glMatrix = {};

/**
 * Sets the type of array used when creating new vectors and matricies
 *
 * @param {Type} type Array type, such as Float32Array or Array
 */
glMatrix.setMatrixArrayType = function(type) {
    GLMAT_ARRAY_TYPE = type;
}

if(typeof(exports) !== 'undefined') {
    exports.glMatrix = glMatrix;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2 Dimensional Vector
 * @name vec2
 */

var vec2 = {};

/**
 * Creates a new, empty vec2
 *
 * @returns {vec2} a new 2D vector
 */
vec2.create = function() {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = 0;
    out[1] = 0;
    return out;
};

/**
 * Creates a new vec2 initialized with values from an existing vector
 *
 * @param {vec2} a vector to clone
 * @returns {vec2} a new 2D vector
 */
vec2.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = a[0];
    out[1] = a[1];
    return out;
};

/**
 * Creates a new vec2 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @returns {vec2} a new 2D vector
 */
vec2.fromValues = function(x, y) {
    var out = new GLMAT_ARRAY_TYPE(2);
    out[0] = x;
    out[1] = y;
    return out;
};

/**
 * Copy the values from one vec2 to another
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the source vector
 * @returns {vec2} out
 */
vec2.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    return out;
};

/**
 * Set the components of a vec2 to the given values
 *
 * @param {vec2} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @returns {vec2} out
 */
vec2.set = function(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
};

/**
 * Adds two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
};

/**
 * Subtracts two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
};

/**
 * Alias for {@link vec2.subtract}
 * @function
 */
vec2.sub = vec2.subtract;

/**
 * Multiplies two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    return out;
};

/**
 * Alias for {@link vec2.multiply}
 * @function
 */
vec2.mul = vec2.multiply;

/**
 * Divides two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    return out;
};

/**
 * Alias for {@link vec2.divide}
 * @function
 */
vec2.div = vec2.divide;

/**
 * Returns the minimum of two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.min = function(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    return out;
};

/**
 * Returns the maximum of two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec2} out
 */
vec2.max = function(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    return out;
};

/**
 * Scales a vec2 by a scalar number
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec2} out
 */
vec2.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    return out;
};

/**
 * Calculates the euclidian distance between two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} distance between a and b
 */
vec2.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1];
    return Math.sqrt(x*x + y*y);
};

/**
 * Alias for {@link vec2.distance}
 * @function
 */
vec2.dist = vec2.distance;

/**
 * Calculates the squared euclidian distance between two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec2.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1];
    return x*x + y*y;
};

/**
 * Alias for {@link vec2.squaredDistance}
 * @function
 */
vec2.sqrDist = vec2.squaredDistance;

/**
 * Calculates the length of a vec2
 *
 * @param {vec2} a vector to calculate length of
 * @returns {Number} length of a
 */
vec2.length = function (a) {
    var x = a[0],
        y = a[1];
    return Math.sqrt(x*x + y*y);
};

/**
 * Alias for {@link vec2.length}
 * @function
 */
vec2.len = vec2.length;

/**
 * Calculates the squared length of a vec2
 *
 * @param {vec2} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec2.squaredLength = function (a) {
    var x = a[0],
        y = a[1];
    return x*x + y*y;
};

/**
 * Alias for {@link vec2.squaredLength}
 * @function
 */
vec2.sqrLen = vec2.squaredLength;

/**
 * Negates the components of a vec2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a vector to negate
 * @returns {vec2} out
 */
vec2.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    return out;
};

/**
 * Normalize a vec2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a vector to normalize
 * @returns {vec2} out
 */
vec2.normalize = function(out, a) {
    var x = a[0],
        y = a[1];
    var len = x*x + y*y;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec2's
 *
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {Number} dot product of a and b
 */
vec2.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1];
};

/**
 * Computes the cross product of two vec2's
 * Note that the cross product must by definition produce a 3D vector
 *
 * @param {vec3} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @returns {vec3} out
 */
vec2.cross = function(out, a, b) {
    var z = a[0] * b[1] - a[1] * b[0];
    out[0] = out[1] = 0;
    out[2] = z;
    return out;
};

/**
 * Performs a linear interpolation between two vec2's
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the first operand
 * @param {vec2} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec2} out
 */
vec2.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    return out;
};

/**
 * Transforms the vec2 with a mat2
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat2} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat2 = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[2] * y;
    out[1] = m[1] * x + m[3] * y;
    return out;
};

/**
 * Transforms the vec2 with a mat2d
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat2d} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat2d = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[2] * y + m[4];
    out[1] = m[1] * x + m[3] * y + m[5];
    return out;
};

/**
 * Transforms the vec2 with a mat3
 * 3rd vector component is implicitly '1'
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat3} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat3 = function(out, a, m) {
    var x = a[0],
        y = a[1];
    out[0] = m[0] * x + m[3] * y + m[6];
    out[1] = m[1] * x + m[4] * y + m[7];
    return out;
};

/**
 * Transforms the vec2 with a mat4
 * 3rd vector component is implicitly '0'
 * 4th vector component is implicitly '1'
 *
 * @param {vec2} out the receiving vector
 * @param {vec2} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec2} out
 */
vec2.transformMat4 = function(out, a, m) {
    var x = a[0], 
        y = a[1];
    out[0] = m[0] * x + m[4] * y + m[12];
    out[1] = m[1] * x + m[5] * y + m[13];
    return out;
};

/**
 * Perform some operation over an array of vec2s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec2. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec2s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec2.forEach = (function() {
    var vec = vec2.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 2;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = Math.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec2} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec2.str = function (a) {
    return 'vec2(' + a[0] + ', ' + a[1] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.vec2 = vec2;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 3 Dimensional Vector
 * @name vec3
 */

var vec3 = {};

/**
 * Creates a new, empty vec3
 *
 * @returns {vec3} a new 3D vector
 */
vec3.create = function() {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
};

/**
 * Creates a new vec3 initialized with values from an existing vector
 *
 * @param {vec3} a vector to clone
 * @returns {vec3} a new 3D vector
 */
vec3.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
};

/**
 * Creates a new vec3 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} a new 3D vector
 */
vec3.fromValues = function(x, y, z) {
    var out = new GLMAT_ARRAY_TYPE(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
};

/**
 * Copy the values from one vec3 to another
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the source vector
 * @returns {vec3} out
 */
vec3.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
};

/**
 * Set the components of a vec3 to the given values
 *
 * @param {vec3} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @returns {vec3} out
 */
vec3.set = function(out, x, y, z) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
};

/**
 * Adds two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
};

/**
 * Subtracts two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
};

/**
 * Alias for {@link vec3.subtract}
 * @function
 */
vec3.sub = vec3.subtract;

/**
 * Multiplies two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    return out;
};

/**
 * Alias for {@link vec3.multiply}
 * @function
 */
vec3.mul = vec3.multiply;

/**
 * Divides two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    return out;
};

/**
 * Alias for {@link vec3.divide}
 * @function
 */
vec3.div = vec3.divide;

/**
 * Returns the minimum of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.min = function(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    out[2] = Math.min(a[2], b[2]);
    return out;
};

/**
 * Returns the maximum of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.max = function(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    out[2] = Math.max(a[2], b[2]);
    return out;
};

/**
 * Scales a vec3 by a scalar number
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec3} out
 */
vec3.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    return out;
};

/**
 * Calculates the euclidian distance between two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} distance between a and b
 */
vec3.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2];
    return Math.sqrt(x*x + y*y + z*z);
};

/**
 * Alias for {@link vec3.distance}
 * @function
 */
vec3.dist = vec3.distance;

/**
 * Calculates the squared euclidian distance between two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec3.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2];
    return x*x + y*y + z*z;
};

/**
 * Alias for {@link vec3.squaredDistance}
 * @function
 */
vec3.sqrDist = vec3.squaredDistance;

/**
 * Calculates the length of a vec3
 *
 * @param {vec3} a vector to calculate length of
 * @returns {Number} length of a
 */
vec3.length = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    return Math.sqrt(x*x + y*y + z*z);
};

/**
 * Alias for {@link vec3.length}
 * @function
 */
vec3.len = vec3.length;

/**
 * Calculates the squared length of a vec3
 *
 * @param {vec3} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec3.squaredLength = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    return x*x + y*y + z*z;
};

/**
 * Alias for {@link vec3.squaredLength}
 * @function
 */
vec3.sqrLen = vec3.squaredLength;

/**
 * Negates the components of a vec3
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a vector to negate
 * @returns {vec3} out
 */
vec3.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    return out;
};

/**
 * Normalize a vec3
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a vector to normalize
 * @returns {vec3} out
 */
vec3.normalize = function(out, a) {
    var x = a[0],
        y = a[1],
        z = a[2];
    var len = x*x + y*y + z*z;
    if (len > 0) {
        //TODO: evaluate use of glm_invsqrt here?
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec3's
 *
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {Number} dot product of a and b
 */
vec3.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
};

/**
 * Computes the cross product of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
vec3.cross = function(out, a, b) {
    var ax = a[0], ay = a[1], az = a[2],
        bx = b[0], by = b[1], bz = b[2];

    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
};

/**
 * Performs a linear interpolation between two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec3} out
 */
vec3.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1],
        az = a[2];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    out[2] = az + t * (b[2] - az);
    return out;
};

/**
 * Transforms the vec3 with a mat4.
 * 4th vector component is implicitly '1'
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec3} out
 */
vec3.transformMat4 = function(out, a, m) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return out;
};

/**
 * Transforms the vec3 with a quat
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the vector to transform
 * @param {quat} q quaternion to transform with
 * @returns {vec3} out
 */
vec3.transformQuat = function(out, a, q) {
    var x = a[0], y = a[1], z = a[2],
        qx = q[0], qy = q[1], qz = q[2], qw = q[3],

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
};

/**
 * Perform some operation over an array of vec3s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec3. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec3s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec3.forEach = (function() {
    var vec = vec3.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 3;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = Math.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1]; vec[2] = a[i+2];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1]; a[i+2] = vec[2];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec3} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec3.str = function (a) {
    return 'vec3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.vec3 = vec3;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 4 Dimensional Vector
 * @name vec4
 */

var vec4 = {};

/**
 * Creates a new, empty vec4
 *
 * @returns {vec4} a new 4D vector
 */
vec4.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    return out;
};

/**
 * Creates a new vec4 initialized with values from an existing vector
 *
 * @param {vec4} a vector to clone
 * @returns {vec4} a new 4D vector
 */
vec4.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Creates a new vec4 initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} a new 4D vector
 */
vec4.fromValues = function(x, y, z, w) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
};

/**
 * Copy the values from one vec4 to another
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the source vector
 * @returns {vec4} out
 */
vec4.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Set the components of a vec4 to the given values
 *
 * @param {vec4} out the receiving vector
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {vec4} out
 */
vec4.set = function(out, x, y, z, w) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
    return out;
};

/**
 * Adds two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.add = function(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    out[3] = a[3] + b[3];
    return out;
};

/**
 * Subtracts two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.subtract = function(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    out[3] = a[3] - b[3];
    return out;
};

/**
 * Alias for {@link vec4.subtract}
 * @function
 */
vec4.sub = vec4.subtract;

/**
 * Multiplies two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.multiply = function(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    out[3] = a[3] * b[3];
    return out;
};

/**
 * Alias for {@link vec4.multiply}
 * @function
 */
vec4.mul = vec4.multiply;

/**
 * Divides two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.divide = function(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    out[3] = a[3] / b[3];
    return out;
};

/**
 * Alias for {@link vec4.divide}
 * @function
 */
vec4.div = vec4.divide;

/**
 * Returns the minimum of two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.min = function(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    out[2] = Math.min(a[2], b[2]);
    out[3] = Math.min(a[3], b[3]);
    return out;
};

/**
 * Returns the maximum of two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {vec4} out
 */
vec4.max = function(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    out[2] = Math.max(a[2], b[2]);
    out[3] = Math.max(a[3], b[3]);
    return out;
};

/**
 * Scales a vec4 by a scalar number
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {vec4} out
 */
vec4.scale = function(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    out[3] = a[3] * b;
    return out;
};

/**
 * Calculates the euclidian distance between two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} distance between a and b
 */
vec4.distance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2],
        w = b[3] - a[3];
    return Math.sqrt(x*x + y*y + z*z + w*w);
};

/**
 * Alias for {@link vec4.distance}
 * @function
 */
vec4.dist = vec4.distance;

/**
 * Calculates the squared euclidian distance between two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} squared distance between a and b
 */
vec4.squaredDistance = function(a, b) {
    var x = b[0] - a[0],
        y = b[1] - a[1],
        z = b[2] - a[2],
        w = b[3] - a[3];
    return x*x + y*y + z*z + w*w;
};

/**
 * Alias for {@link vec4.squaredDistance}
 * @function
 */
vec4.sqrDist = vec4.squaredDistance;

/**
 * Calculates the length of a vec4
 *
 * @param {vec4} a vector to calculate length of
 * @returns {Number} length of a
 */
vec4.length = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    return Math.sqrt(x*x + y*y + z*z + w*w);
};

/**
 * Alias for {@link vec4.length}
 * @function
 */
vec4.len = vec4.length;

/**
 * Calculates the squared length of a vec4
 *
 * @param {vec4} a vector to calculate squared length of
 * @returns {Number} squared length of a
 */
vec4.squaredLength = function (a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    return x*x + y*y + z*z + w*w;
};

/**
 * Alias for {@link vec4.squaredLength}
 * @function
 */
vec4.sqrLen = vec4.squaredLength;

/**
 * Negates the components of a vec4
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a vector to negate
 * @returns {vec4} out
 */
vec4.negate = function(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = -a[3];
    return out;
};

/**
 * Normalize a vec4
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a vector to normalize
 * @returns {vec4} out
 */
vec4.normalize = function(out, a) {
    var x = a[0],
        y = a[1],
        z = a[2],
        w = a[3];
    var len = x*x + y*y + z*z + w*w;
    if (len > 0) {
        len = 1 / Math.sqrt(len);
        out[0] = a[0] * len;
        out[1] = a[1] * len;
        out[2] = a[2] * len;
        out[3] = a[3] * len;
    }
    return out;
};

/**
 * Calculates the dot product of two vec4's
 *
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @returns {Number} dot product of a and b
 */
vec4.dot = function (a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
};

/**
 * Performs a linear interpolation between two vec4's
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the first operand
 * @param {vec4} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {vec4} out
 */
vec4.lerp = function (out, a, b, t) {
    var ax = a[0],
        ay = a[1],
        az = a[2],
        aw = a[3];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    out[2] = az + t * (b[2] - az);
    out[3] = aw + t * (b[3] - aw);
    return out;
};

/**
 * Transforms the vec4 with a mat4.
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to transform
 * @param {mat4} m matrix to transform with
 * @returns {vec4} out
 */
vec4.transformMat4 = function(out, a, m) {
    var x = a[0], y = a[1], z = a[2], w = a[3];
    out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
    out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
    out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
    out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
    return out;
};

/**
 * Transforms the vec4 with a quat
 *
 * @param {vec4} out the receiving vector
 * @param {vec4} a the vector to transform
 * @param {quat} q quaternion to transform with
 * @returns {vec4} out
 */
vec4.transformQuat = function(out, a, q) {
    var x = a[0], y = a[1], z = a[2],
        qx = q[0], qy = q[1], qz = q[2], qw = q[3],

        // calculate quat * vec
        ix = qw * x + qy * z - qz * y,
        iy = qw * y + qz * x - qx * z,
        iz = qw * z + qx * y - qy * x,
        iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
};

/**
 * Perform some operation over an array of vec4s.
 *
 * @param {Array} a the array of vectors to iterate over
 * @param {Number} stride Number of elements between the start of each vec4. If 0 assumes tightly packed
 * @param {Number} offset Number of elements to skip at the beginning of the array
 * @param {Number} count Number of vec2s to iterate over. If 0 iterates over entire array
 * @param {Function} fn Function to call for each vector in the array
 * @param {Object} [arg] additional argument to pass to fn
 * @returns {Array} a
 * @function
 */
vec4.forEach = (function() {
    var vec = vec4.create();

    return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if(!stride) {
            stride = 4;
        }

        if(!offset) {
            offset = 0;
        }
        
        if(count) {
            l = Math.min((count * stride) + offset, a.length);
        } else {
            l = a.length;
        }

        for(i = offset; i < l; i += stride) {
            vec[0] = a[i]; vec[1] = a[i+1]; vec[2] = a[i+2]; vec[3] = a[i+3];
            fn(vec, vec, arg);
            a[i] = vec[0]; a[i+1] = vec[1]; a[i+2] = vec[2]; a[i+3] = vec[3];
        }
        
        return a;
    };
})();

/**
 * Returns a string representation of a vector
 *
 * @param {vec4} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
vec4.str = function (a) {
    return 'vec4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.vec4 = vec4;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2x2 Matrix
 * @name mat2
 */

var mat2 = {};

var mat2Identity = new Float32Array([
    1, 0,
    0, 1
]);

/**
 * Creates a new identity mat2
 *
 * @returns {mat2} a new 2x2 matrix
 */
mat2.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Creates a new mat2 initialized with values from an existing matrix
 *
 * @param {mat2} a matrix to clone
 * @returns {mat2} a new 2x2 matrix
 */
mat2.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Copy the values from one mat2 to another
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
};

/**
 * Set a mat2 to the identity matrix
 *
 * @param {mat2} out the receiving matrix
 * @returns {mat2} out
 */
mat2.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Transpose the values of a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a1 = a[1];
        out[1] = a[2];
        out[2] = a1;
    } else {
        out[0] = a[0];
        out[1] = a[2];
        out[2] = a[1];
        out[3] = a[3];
    }
    
    return out;
};

/**
 * Inverts a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.invert = function(out, a) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],

        // Calculate the determinant
        det = a0 * a3 - a2 * a1;

    if (!det) {
        return null;
    }
    det = 1.0 / det;
    
    out[0] =  a3 * det;
    out[1] = -a1 * det;
    out[2] = -a2 * det;
    out[3] =  a0 * det;

    return out;
};

/**
 * Calculates the adjugate of a mat2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the source matrix
 * @returns {mat2} out
 */
mat2.adjoint = function(out, a) {
    // Caching this value is nessecary if out == a
    var a0 = a[0];
    out[0] =  a[3];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] =  a0;

    return out;
};

/**
 * Calculates the determinant of a mat2
 *
 * @param {mat2} a the source matrix
 * @returns {Number} determinant of a
 */
mat2.determinant = function (a) {
    return a[0] * a[3] - a[2] * a[1];
};

/**
 * Multiplies two mat2's
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the first operand
 * @param {mat2} b the second operand
 * @returns {mat2} out
 */
mat2.multiply = function (out, a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = a0 * b0 + a1 * b2;
    out[1] = a0 * b1 + a1 * b3;
    out[2] = a2 * b0 + a3 * b2;
    out[3] = a2 * b1 + a3 * b3;
    return out;
};

/**
 * Alias for {@link mat2.multiply}
 * @function
 */
mat2.mul = mat2.multiply;

/**
 * Rotates a mat2 by the given angle
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2} out
 */
mat2.rotate = function (out, a, rad) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        s = Math.sin(rad),
        c = Math.cos(rad);
    out[0] = a0 *  c + a1 * s;
    out[1] = a0 * -s + a1 * c;
    out[2] = a2 *  c + a3 * s;
    out[3] = a2 * -s + a3 * c;
    return out;
};

/**
 * Scales the mat2 by the dimensions in the given vec2
 *
 * @param {mat2} out the receiving matrix
 * @param {mat2} a the matrix to rotate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat2} out
 **/
mat2.scale = function(out, a, v) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        v0 = v[0], v1 = v[1];
    out[0] = a0 * v0;
    out[1] = a1 * v1;
    out[2] = a2 * v0;
    out[3] = a3 * v1;
    return out;
};

/**
 * Returns a string representation of a mat2
 *
 * @param {mat2} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat2.str = function (a) {
    return 'mat2(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.mat2 = mat2;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 2x3 Matrix
 * @name mat2d
 * 
 * @description 
 * A mat2d contains six elements defined as:
 * <pre>
 * [a, b,
 *  c, d,
 *  tx,ty]
 * </pre>
 * This is a short form for the 3x3 matrix:
 * <pre>
 * [a, b, 0
 *  c, d, 0
 *  tx,ty,1]
 * </pre>
 * The last column is ignored so the array is shorter and operations are faster.
 */

var mat2d = {};

var mat2dIdentity = new Float32Array([
    1, 0,
    0, 1,
    0, 0
]);

/**
 * Creates a new identity mat2d
 *
 * @returns {mat2d} a new 2x3 matrix
 */
mat2d.create = function() {
    var out = new GLMAT_ARRAY_TYPE(6);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = 0;
    out[5] = 0;
    return out;
};

/**
 * Creates a new mat2d initialized with values from an existing matrix
 *
 * @param {mat2d} a matrix to clone
 * @returns {mat2d} a new 2x3 matrix
 */
mat2d.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(6);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    return out;
};

/**
 * Copy the values from one mat2d to another
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the source matrix
 * @returns {mat2d} out
 */
mat2d.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    return out;
};

/**
 * Set a mat2d to the identity matrix
 *
 * @param {mat2d} out the receiving matrix
 * @returns {mat2d} out
 */
mat2d.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = 0;
    out[5] = 0;
    return out;
};

/**
 * Inverts a mat2d
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the source matrix
 * @returns {mat2d} out
 */
mat2d.invert = function(out, a) {
    var aa = a[0], ab = a[1], ac = a[2], ad = a[3],
        atx = a[4], aty = a[5];

    var det = aa * ad - ab * ac;
    if(!det){
        return null;
    }
    det = 1.0 / det;

    out[0] = ad * det;
    out[1] = -ab * det;
    out[2] = -ac * det;
    out[3] = aa * det;
    out[4] = (ac * aty - ad * atx) * det;
    out[5] = (ab * atx - aa * aty) * det;
    return out;
};

/**
 * Calculates the determinant of a mat2d
 *
 * @param {mat2d} a the source matrix
 * @returns {Number} determinant of a
 */
mat2d.determinant = function (a) {
    return a[0] * a[3] - a[1] * a[2];
};

/**
 * Multiplies two mat2d's
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the first operand
 * @param {mat2d} b the second operand
 * @returns {mat2d} out
 */
mat2d.multiply = function (out, a, b) {
    var aa = a[0], ab = a[1], ac = a[2], ad = a[3],
        atx = a[4], aty = a[5],
        ba = b[0], bb = b[1], bc = b[2], bd = b[3],
        btx = b[4], bty = b[5];

    out[0] = aa*ba + ab*bc;
    out[1] = aa*bb + ab*bd;
    out[2] = ac*ba + ad*bc;
    out[3] = ac*bb + ad*bd;
    out[4] = ba*atx + bc*aty + btx;
    out[5] = bb*atx + bd*aty + bty;
    return out;
};

/**
 * Alias for {@link mat2d.multiply}
 * @function
 */
mat2d.mul = mat2d.multiply;


/**
 * Rotates a mat2d by the given angle
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat2d} out
 */
mat2d.rotate = function (out, a, rad) {
    var aa = a[0],
        ab = a[1],
        ac = a[2],
        ad = a[3],
        atx = a[4],
        aty = a[5],
        st = Math.sin(rad),
        ct = Math.cos(rad);

    out[0] = aa*ct + ab*st;
    out[1] = -aa*st + ab*ct;
    out[2] = ac*ct + ad*st;
    out[3] = -ac*st + ct*ad;
    out[4] = ct*atx + st*aty;
    out[5] = ct*aty - st*atx;
    return out;
};

/**
 * Scales the mat2d by the dimensions in the given vec2
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to translate
 * @param {mat2d} v the vec2 to scale the matrix by
 * @returns {mat2d} out
 **/
mat2d.scale = function(out, a, v) {
    var vx = v[0], vy = v[1];
    out[0] = a[0] * vx;
    out[1] = a[1] * vy;
    out[2] = a[2] * vx;
    out[3] = a[3] * vy;
    out[4] = a[4] * vx;
    out[5] = a[5] * vy;
    return out;
};

/**
 * Translates the mat2d by the dimensions in the given vec2
 *
 * @param {mat2d} out the receiving matrix
 * @param {mat2d} a the matrix to translate
 * @param {mat2d} v the vec2 to translate the matrix by
 * @returns {mat2d} out
 **/
mat2d.translate = function(out, a, v) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4] + v[0];
    out[5] = a[5] + v[1];
    return out;
};

/**
 * Returns a string representation of a mat2d
 *
 * @param {mat2d} a matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat2d.str = function (a) {
    return 'mat2d(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + 
                    a[3] + ', ' + a[4] + ', ' + a[5] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.mat2d = mat2d;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 3x3 Matrix
 * @name mat3
 */

var mat3 = {};

var mat3Identity = new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
]);

/**
 * Creates a new identity mat3
 *
 * @returns {mat3} a new 3x3 matrix
 */
mat3.create = function() {
    var out = new GLMAT_ARRAY_TYPE(9);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
};

/**
 * Creates a new mat3 initialized with values from an existing matrix
 *
 * @param {mat3} a matrix to clone
 * @returns {mat3} a new 3x3 matrix
 */
mat3.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(9);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Copy the values from one mat3 to another
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Set a mat3 to the identity matrix
 *
 * @param {mat3} out the receiving matrix
 * @returns {mat3} out
 */
mat3.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
};

/**
 * Transpose the values of a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a01 = a[1], a02 = a[2], a12 = a[5];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a01;
        out[5] = a[7];
        out[6] = a02;
        out[7] = a12;
    } else {
        out[0] = a[0];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a[1];
        out[4] = a[4];
        out[5] = a[7];
        out[6] = a[2];
        out[7] = a[5];
        out[8] = a[8];
    }
    
    return out;
};

/**
 * Inverts a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.invert = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b01 = a22 * a11 - a12 * a21,
        b11 = -a22 * a10 + a12 * a20,
        b21 = a21 * a10 - a11 * a20,

        // Calculate the determinant
        det = a00 * b01 + a01 * b11 + a02 * b21;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;
    return out;
};

/**
 * Calculates the adjugate of a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the source matrix
 * @returns {mat3} out
 */
mat3.adjoint = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    out[0] = (a11 * a22 - a12 * a21);
    out[1] = (a02 * a21 - a01 * a22);
    out[2] = (a01 * a12 - a02 * a11);
    out[3] = (a12 * a20 - a10 * a22);
    out[4] = (a00 * a22 - a02 * a20);
    out[5] = (a02 * a10 - a00 * a12);
    out[6] = (a10 * a21 - a11 * a20);
    out[7] = (a01 * a20 - a00 * a21);
    out[8] = (a00 * a11 - a01 * a10);
    return out;
};

/**
 * Calculates the determinant of a mat3
 *
 * @param {mat3} a the source matrix
 * @returns {Number} determinant of a
 */
mat3.determinant = function (a) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8];

    return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
};

/**
 * Multiplies two mat3's
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the first operand
 * @param {mat3} b the second operand
 * @returns {mat3} out
 */
mat3.multiply = function (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        b00 = b[0], b01 = b[1], b02 = b[2],
        b10 = b[3], b11 = b[4], b12 = b[5],
        b20 = b[6], b21 = b[7], b22 = b[8];

    out[0] = b00 * a00 + b01 * a10 + b02 * a20;
    out[1] = b00 * a01 + b01 * a11 + b02 * a21;
    out[2] = b00 * a02 + b01 * a12 + b02 * a22;

    out[3] = b10 * a00 + b11 * a10 + b12 * a20;
    out[4] = b10 * a01 + b11 * a11 + b12 * a21;
    out[5] = b10 * a02 + b11 * a12 + b12 * a22;

    out[6] = b20 * a00 + b21 * a10 + b22 * a20;
    out[7] = b20 * a01 + b21 * a11 + b22 * a21;
    out[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return out;
};

/**
 * Alias for {@link mat3.multiply}
 * @function
 */
mat3.mul = mat3.multiply;

/**
 * Translate a mat3 by the given vector
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to translate
 * @param {vec2} v vector to translate by
 * @returns {mat3} out
 */
mat3.translate = function(out, a, v) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],
        x = v[0], y = v[1];

    out[0] = a00;
    out[1] = a01;
    out[2] = a02;

    out[3] = a10;
    out[4] = a11;
    out[5] = a12;

    out[6] = x * a00 + y * a10 + a20;
    out[7] = x * a01 + y * a11 + a21;
    out[8] = x * a02 + y * a12 + a22;
    return out;
};

/**
 * Rotates a mat3 by the given angle
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat3} out
 */
mat3.rotate = function (out, a, rad) {
    var a00 = a[0], a01 = a[1], a02 = a[2],
        a10 = a[3], a11 = a[4], a12 = a[5],
        a20 = a[6], a21 = a[7], a22 = a[8],

        s = Math.sin(rad),
        c = Math.cos(rad);

    out[0] = c * a00 + s * a10;
    out[1] = c * a01 + s * a11;
    out[2] = c * a02 + s * a12;

    out[3] = c * a10 - s * a00;
    out[4] = c * a11 - s * a01;
    out[5] = c * a12 - s * a02;

    out[6] = a20;
    out[7] = a21;
    out[8] = a22;
    return out;
};

/**
 * Scales the mat3 by the dimensions in the given vec2
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to rotate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat3} out
 **/
mat3.scale = function(out, a, v) {
    var x = v[0], y = v[2];

    out[0] = x * a[0];
    out[1] = x * a[1];
    out[2] = x * a[2];

    out[3] = y * a[3];
    out[4] = y * a[4];
    out[5] = y * a[5];

    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
};

/**
 * Copies the values from a mat2d into a mat3
 *
 * @param {mat3} out the receiving matrix
 * @param {mat3} a the matrix to rotate
 * @param {vec2} v the vec2 to scale the matrix by
 * @returns {mat3} out
 **/
mat3.fromMat2d = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = 0;

    out[3] = a[2];
    out[4] = a[3];
    out[5] = 0;

    out[6] = a[4];
    out[7] = a[5];
    out[8] = 1;
    return out;
};

/**
* Calculates a 3x3 matrix from the given quaternion
*
* @param {mat3} out mat3 receiving operation result
* @param {quat} q Quaternion to create matrix from
*
* @returns {mat3} out
*/
mat3.fromQuat = function (out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;

    out[3] = xy - wz;
    out[4] = 1 - (xx + zz);
    out[5] = yz + wx;

    out[6] = xz + wy;
    out[7] = yz - wx;
    out[8] = 1 - (xx + yy);

    return out;
};

/**
 * Returns a string representation of a mat3
 *
 * @param {mat3} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat3.str = function (a) {
    return 'mat3(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + 
                    a[3] + ', ' + a[4] + ', ' + a[5] + ', ' + 
                    a[6] + ', ' + a[7] + ', ' + a[8] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.mat3 = mat3;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class 4x4 Matrix
 * @name mat4
 */

var mat4 = {};

var mat4Identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);

/**
 * Creates a new identity mat4
 *
 * @returns {mat4} a new 4x4 matrix
 */
mat4.create = function() {
    var out = new GLMAT_ARRAY_TYPE(16);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
};

/**
 * Creates a new mat4 initialized with values from an existing matrix
 *
 * @param {mat4} a matrix to clone
 * @returns {mat4} a new 4x4 matrix
 */
mat4.clone = function(a) {
    var out = new GLMAT_ARRAY_TYPE(16);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Copy the values from one mat4 to another
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.copy = function(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Set a mat4 to the identity matrix
 *
 * @param {mat4} out the receiving matrix
 * @returns {mat4} out
 */
mat4.identity = function(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
};

/**
 * Transpose the values of a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.transpose = function(out, a) {
    // If we are transposing ourselves we can skip a few steps but have to cache some values
    if (out === a) {
        var a01 = a[1], a02 = a[2], a03 = a[3],
            a12 = a[6], a13 = a[7],
            a23 = a[11];

        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a01;
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a02;
        out[9] = a12;
        out[11] = a[14];
        out[12] = a03;
        out[13] = a13;
        out[14] = a23;
    } else {
        out[0] = a[0];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a[1];
        out[5] = a[5];
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a[2];
        out[9] = a[6];
        out[10] = a[10];
        out[11] = a[14];
        out[12] = a[3];
        out[13] = a[7];
        out[14] = a[11];
        out[15] = a[15];
    }
    
    return out;
};

/**
 * Inverts a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.invert = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
};

/**
 * Calculates the adjugate of a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
mat4.adjoint = function(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    out[0]  =  (a11 * (a22 * a33 - a23 * a32) - a21 * (a12 * a33 - a13 * a32) + a31 * (a12 * a23 - a13 * a22));
    out[1]  = -(a01 * (a22 * a33 - a23 * a32) - a21 * (a02 * a33 - a03 * a32) + a31 * (a02 * a23 - a03 * a22));
    out[2]  =  (a01 * (a12 * a33 - a13 * a32) - a11 * (a02 * a33 - a03 * a32) + a31 * (a02 * a13 - a03 * a12));
    out[3]  = -(a01 * (a12 * a23 - a13 * a22) - a11 * (a02 * a23 - a03 * a22) + a21 * (a02 * a13 - a03 * a12));
    out[4]  = -(a10 * (a22 * a33 - a23 * a32) - a20 * (a12 * a33 - a13 * a32) + a30 * (a12 * a23 - a13 * a22));
    out[5]  =  (a00 * (a22 * a33 - a23 * a32) - a20 * (a02 * a33 - a03 * a32) + a30 * (a02 * a23 - a03 * a22));
    out[6]  = -(a00 * (a12 * a33 - a13 * a32) - a10 * (a02 * a33 - a03 * a32) + a30 * (a02 * a13 - a03 * a12));
    out[7]  =  (a00 * (a12 * a23 - a13 * a22) - a10 * (a02 * a23 - a03 * a22) + a20 * (a02 * a13 - a03 * a12));
    out[8]  =  (a10 * (a21 * a33 - a23 * a31) - a20 * (a11 * a33 - a13 * a31) + a30 * (a11 * a23 - a13 * a21));
    out[9]  = -(a00 * (a21 * a33 - a23 * a31) - a20 * (a01 * a33 - a03 * a31) + a30 * (a01 * a23 - a03 * a21));
    out[10] =  (a00 * (a11 * a33 - a13 * a31) - a10 * (a01 * a33 - a03 * a31) + a30 * (a01 * a13 - a03 * a11));
    out[11] = -(a00 * (a11 * a23 - a13 * a21) - a10 * (a01 * a23 - a03 * a21) + a20 * (a01 * a13 - a03 * a11));
    out[12] = -(a10 * (a21 * a32 - a22 * a31) - a20 * (a11 * a32 - a12 * a31) + a30 * (a11 * a22 - a12 * a21));
    out[13] =  (a00 * (a21 * a32 - a22 * a31) - a20 * (a01 * a32 - a02 * a31) + a30 * (a01 * a22 - a02 * a21));
    out[14] = -(a00 * (a11 * a32 - a12 * a31) - a10 * (a01 * a32 - a02 * a31) + a30 * (a01 * a12 - a02 * a11));
    out[15] =  (a00 * (a11 * a22 - a12 * a21) - a10 * (a01 * a22 - a02 * a21) + a20 * (a01 * a12 - a02 * a11));
    return out;
};

/**
 * Calculates the determinant of a mat4
 *
 * @param {mat4} a the source matrix
 * @returns {Number} determinant of a
 */
mat4.determinant = function (a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32;

    // Calculate the determinant
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
};

/**
 * Multiplies two mat4's
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the first operand
 * @param {mat4} b the second operand
 * @returns {mat4} out
 */
mat4.multiply = function (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    // Cache only the current line of the second matrix
    var b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];  
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return out;
};

/**
 * Alias for {@link mat4.multiply}
 * @function
 */
mat4.mul = mat4.multiply;

/**
 * Translate a mat4 by the given vector
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to translate
 * @param {vec3} v vector to translate by
 * @returns {mat4} out
 */
mat4.translate = function (out, a, v) {
    var x = v[0], y = v[1], z = v[2],
        a00, a01, a02, a03,
        a10, a11, a12, a13,
        a20, a21, a22, a23;

    if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    } else {
        a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
        a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
        a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

        out[0] = a00; out[1] = a01; out[2] = a02; out[3] = a03;
        out[4] = a10; out[5] = a11; out[6] = a12; out[7] = a13;
        out[8] = a20; out[9] = a21; out[10] = a22; out[11] = a23;

        out[12] = a00 * x + a10 * y + a20 * z + a[12];
        out[13] = a01 * x + a11 * y + a21 * z + a[13];
        out[14] = a02 * x + a12 * y + a22 * z + a[14];
        out[15] = a03 * x + a13 * y + a23 * z + a[15];
    }

    return out;
};

/**
 * Scales the mat4 by the dimensions in the given vec3
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to scale
 * @param {vec3} v the vec3 to scale the matrix by
 * @returns {mat4} out
 **/
mat4.scale = function(out, a, v) {
    var x = v[0], y = v[1], z = v[2];

    out[0] = a[0] * x;
    out[1] = a[1] * x;
    out[2] = a[2] * x;
    out[3] = a[3] * x;
    out[4] = a[4] * y;
    out[5] = a[5] * y;
    out[6] = a[6] * y;
    out[7] = a[7] * y;
    out[8] = a[8] * z;
    out[9] = a[9] * z;
    out[10] = a[10] * z;
    out[11] = a[11] * z;
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
};

/**
 * Rotates a mat4 by the given angle
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @param {vec3} axis the axis to rotate around
 * @returns {mat4} out
 */
mat4.rotate = function (out, a, rad, axis) {
    var x = axis[0], y = axis[1], z = axis[2],
        len = Math.sqrt(x * x + y * y + z * z),
        s, c, t,
        a00, a01, a02, a03,
        a10, a11, a12, a13,
        a20, a21, a22, a23,
        b00, b01, b02,
        b10, b11, b12,
        b20, b21, b22;

    if (Math.abs(len) < GLMAT_EPSILON) { return null; }
    
    len = 1 / len;
    x *= len;
    y *= len;
    z *= len;

    s = Math.sin(rad);
    c = Math.cos(rad);
    t = 1 - c;

    a00 = a[0]; a01 = a[1]; a02 = a[2]; a03 = a[3];
    a10 = a[4]; a11 = a[5]; a12 = a[6]; a13 = a[7];
    a20 = a[8]; a21 = a[9]; a22 = a[10]; a23 = a[11];

    // Construct the elements of the rotation matrix
    b00 = x * x * t + c; b01 = y * x * t + z * s; b02 = z * x * t - y * s;
    b10 = x * y * t - z * s; b11 = y * y * t + c; b12 = z * y * t + x * s;
    b20 = x * z * t + y * s; b21 = y * z * t - x * s; b22 = z * z * t + c;

    // Perform rotation-specific matrix multiplication
    out[0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22;

    if (a !== out) { // If the source and destination differ, copy the unchanged last row
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }
    return out;
};

/**
 * Rotates a matrix by the given angle around the X axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateX = function (out, a, rad) {
    var s = Math.sin(rad),
        c = Math.cos(rad),
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    if (a !== out) { // If the source and destination differ, copy the unchanged rows
        out[0]  = a[0];
        out[1]  = a[1];
        out[2]  = a[2];
        out[3]  = a[3];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[4] = a10 * c + a20 * s;
    out[5] = a11 * c + a21 * s;
    out[6] = a12 * c + a22 * s;
    out[7] = a13 * c + a23 * s;
    out[8] = a20 * c - a10 * s;
    out[9] = a21 * c - a11 * s;
    out[10] = a22 * c - a12 * s;
    out[11] = a23 * c - a13 * s;
    return out;
};

/**
 * Rotates a matrix by the given angle around the Y axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateY = function (out, a, rad) {
    var s = Math.sin(rad),
        c = Math.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11];

    if (a !== out) { // If the source and destination differ, copy the unchanged rows
        out[4]  = a[4];
        out[5]  = a[5];
        out[6]  = a[6];
        out[7]  = a[7];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[0] = a00 * c - a20 * s;
    out[1] = a01 * c - a21 * s;
    out[2] = a02 * c - a22 * s;
    out[3] = a03 * c - a23 * s;
    out[8] = a00 * s + a20 * c;
    out[9] = a01 * s + a21 * c;
    out[10] = a02 * s + a22 * c;
    out[11] = a03 * s + a23 * c;
    return out;
};

/**
 * Rotates a matrix by the given angle around the Z axis
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the matrix to rotate
 * @param {Number} rad the angle to rotate the matrix by
 * @returns {mat4} out
 */
mat4.rotateZ = function (out, a, rad) {
    var s = Math.sin(rad),
        c = Math.cos(rad),
        a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7];

    if (a !== out) { // If the source and destination differ, copy the unchanged last row
        out[8]  = a[8];
        out[9]  = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
    }

    // Perform axis-specific matrix multiplication
    out[0] = a00 * c + a10 * s;
    out[1] = a01 * c + a11 * s;
    out[2] = a02 * c + a12 * s;
    out[3] = a03 * c + a13 * s;
    out[4] = a10 * c - a00 * s;
    out[5] = a11 * c - a01 * s;
    out[6] = a12 * c - a02 * s;
    out[7] = a13 * c - a03 * s;
    return out;
};

/**
 * Creates a matrix from a quaternion rotation and vector translation
 * This is equivalent to (but much faster than):
 *
 *     mat4.identity(dest);
 *     mat4.translate(dest, vec);
 *     var quatMat = mat4.create();
 *     quat4.toMat4(quat, quatMat);
 *     mat4.multiply(dest, quatMat);
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {quat4} q Rotation quaternion
 * @param {vec3} v Translation vector
 * @returns {mat4} out
 */
mat4.fromRotationTranslation = function (out, q, v) {
    // Quaternion math
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;
    
    return out;
};

/**
* Calculates a 4x4 matrix from the given quaternion
*
* @param {mat4} out mat4 receiving operation result
* @param {quat} q Quaternion to create matrix from
*
* @returns {mat4} out
*/
mat4.fromQuat = function (out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;

    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz + wx;
    out[7] = 0;

    out[8] = xz + wy;
    out[9] = yz - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;

    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;

    return out;
};

/**
 * Generates a frustum matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {Number} left Left bound of the frustum
 * @param {Number} right Right bound of the frustum
 * @param {Number} bottom Bottom bound of the frustum
 * @param {Number} top Top bound of the frustum
 * @param {Number} near Near bound of the frustum
 * @param {Number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.frustum = function (out, left, right, bottom, top, near, far) {
    var rl = 1 / (right - left),
        tb = 1 / (top - bottom),
        nf = 1 / (near - far);
    out[0] = (near * 2) * rl;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = (near * 2) * tb;
    out[6] = 0;
    out[7] = 0;
    out[8] = (right + left) * rl;
    out[9] = (top + bottom) * tb;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (far * near * 2) * nf;
    out[15] = 0;
    return out;
};

/**
 * Generates a perspective projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.perspective = function (out, fovy, aspect, near, far) {
    var f = 1.0 / Math.tan(fovy / 2),
        nf = 1 / (near - far);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;
    return out;
};

/**
 * Generates a orthogonal projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} left Left bound of the frustum
 * @param {number} right Right bound of the frustum
 * @param {number} bottom Bottom bound of the frustum
 * @param {number} top Top bound of the frustum
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
mat4.ortho = function (out, left, right, bottom, top, near, far) {
    var lr = 1 / (left - right),
        bt = 1 / (bottom - top),
        nf = 1 / (near - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 * nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return out;
};

/**
 * Generates a look-at matrix with the given eye position, focal point, and up axis
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {vec3} eye Position of the viewer
 * @param {vec3} center Point the viewer is looking at
 * @param {vec3} up vec3 pointing up
 * @returns {mat4} out
 */
mat4.lookAt = function (out, eye, center, up) {
    var x0, x1, x2, y0, y1, y2, z0, z1, z2, len,
        eyex = eye[0],
        eyey = eye[1],
        eyez = eye[2],
        upx = up[0],
        upy = up[1],
        upz = up[2],
        centerx = center[0],
        centery = center[1],
        centerz = center[2];

    if (Math.abs(eyex - centerx) < GLMAT_EPSILON &&
        Math.abs(eyey - centery) < GLMAT_EPSILON &&
        Math.abs(eyez - centerz) < GLMAT_EPSILON) {
        return mat4.identity(out);
    }

    z0 = eyex - centerx;
    z1 = eyey - centery;
    z2 = eyez - centerz;

    len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    z0 *= len;
    z1 *= len;
    z2 *= len;

    x0 = upy * z2 - upz * z1;
    x1 = upz * z0 - upx * z2;
    x2 = upx * z1 - upy * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
    } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
    }

    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;

    len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
    if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
    } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
    }

    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1;

    return out;
};

/**
 * Returns a string representation of a mat4
 *
 * @param {mat4} mat matrix to represent as a string
 * @returns {String} string representation of the matrix
 */
mat4.str = function (a) {
    return 'mat4(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ', ' +
                    a[4] + ', ' + a[5] + ', ' + a[6] + ', ' + a[7] + ', ' +
                    a[8] + ', ' + a[9] + ', ' + a[10] + ', ' + a[11] + ', ' + 
                    a[12] + ', ' + a[13] + ', ' + a[14] + ', ' + a[15] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.mat4 = mat4;
}
;
/* Copyright (c) 2013, Brandon Jones, Colin MacKenzie IV. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation 
    and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. */

/**
 * @class Quaternion
 * @name quat
 */

var quat = {};

var quatIdentity = new Float32Array([0, 0, 0, 1]);

/**
 * Creates a new identity quat
 *
 * @returns {quat} a new quaternion
 */
quat.create = function() {
    var out = new GLMAT_ARRAY_TYPE(4);
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Creates a new quat initialized with values from an existing quaternion
 *
 * @param {quat} a quaternion to clone
 * @returns {quat} a new quaternion
 * @function
 */
quat.clone = vec4.clone;

/**
 * Creates a new quat initialized with the given values
 *
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} a new quaternion
 * @function
 */
quat.fromValues = vec4.fromValues;

/**
 * Copy the values from one quat to another
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the source quaternion
 * @returns {quat} out
 * @function
 */
quat.copy = vec4.copy;

/**
 * Set the components of a quat to the given values
 *
 * @param {quat} out the receiving quaternion
 * @param {Number} x X component
 * @param {Number} y Y component
 * @param {Number} z Z component
 * @param {Number} w W component
 * @returns {quat} out
 * @function
 */
quat.set = vec4.set;

/**
 * Set a quat to the identity quaternion
 *
 * @param {quat} out the receiving quaternion
 * @returns {quat} out
 */
quat.identity = function(out) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    return out;
};

/**
 * Sets a quat from the given angle and rotation axis,
 * then returns it.
 *
 * @param {quat} out the receiving quaternion
 * @param {vec3} axis the axis around which to rotate
 * @param {Number} rad the angle in radians
 * @returns {quat} out
 **/
quat.setAxisAngle = function(out, axis, rad) {
    rad = rad * 0.5;
    var s = Math.sin(rad);
    out[0] = s * axis[0];
    out[1] = s * axis[1];
    out[2] = s * axis[2];
    out[3] = Math.cos(rad);
    return out;
};

/**
 * Adds two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {quat} out
 * @function
 */
quat.add = vec4.add;

/**
 * Multiplies two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {quat} out
 */
quat.multiply = function(out, a, b) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = b[0], by = b[1], bz = b[2], bw = b[3];

    out[0] = ax * bw + aw * bx + ay * bz - az * by;
    out[1] = ay * bw + aw * by + az * bx - ax * bz;
    out[2] = az * bw + aw * bz + ax * by - ay * bx;
    out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
};

/**
 * Alias for {@link quat.multiply}
 * @function
 */
quat.mul = quat.multiply;

/**
 * Scales a quat by a scalar number
 *
 * @param {quat} out the receiving vector
 * @param {quat} a the vector to scale
 * @param {Number} b amount to scale the vector by
 * @returns {quat} out
 * @function
 */
quat.scale = vec4.scale;

/**
 * Rotates a quaternion by the given angle around the X axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateX = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = Math.sin(rad), bw = Math.cos(rad);

    out[0] = ax * bw + aw * bx;
    out[1] = ay * bw + az * bx;
    out[2] = az * bw - ay * bx;
    out[3] = aw * bw - ax * bx;
    return out;
};

/**
 * Rotates a quaternion by the given angle around the Y axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateY = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        by = Math.sin(rad), bw = Math.cos(rad);

    out[0] = ax * bw - az * by;
    out[1] = ay * bw + aw * by;
    out[2] = az * bw + ax * by;
    out[3] = aw * bw - ay * by;
    return out;
};

/**
 * Rotates a quaternion by the given angle around the Z axis
 *
 * @param {quat} out quat receiving operation result
 * @param {quat} a quat to rotate
 * @param {number} rad angle (in radians) to rotate
 * @returns {quat} out
 */
quat.rotateZ = function (out, a, rad) {
    rad *= 0.5; 

    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bz = Math.sin(rad), bw = Math.cos(rad);

    out[0] = ax * bw + ay * bz;
    out[1] = ay * bw - ax * bz;
    out[2] = az * bw + aw * bz;
    out[3] = aw * bw - az * bz;
    return out;
};

/**
 * Calculates the W component of a quat from the X, Y, and Z components.
 * Assumes that quaternion is 1 unit in length.
 * Any existing W component will be ignored.
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate W component of
 * @returns {quat} out
 */
quat.calculateW = function (out, a) {
    var x = a[0], y = a[1], z = a[2];

    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = -Math.sqrt(Math.abs(1.0 - x * x - y * y - z * z));
    return out;
};

/**
 * Calculates the dot product of two quat's
 *
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @returns {Number} dot product of a and b
 * @function
 */
quat.dot = vec4.dot;

/**
 * Performs a linear interpolation between two quat's
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {quat} out
 * @function
 */
quat.lerp = vec4.lerp;

/**
 * Performs a spherical linear interpolation between two quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a the first operand
 * @param {quat} b the second operand
 * @param {Number} t interpolation amount between the two inputs
 * @returns {quat} out
 */
quat.slerp = function (out, a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3],
        bx = b[0], by = b[1], bz = b[2], bw = b[3];

    var cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw,
        halfTheta,
        sinHalfTheta,
        ratioA,
        ratioB;

    if (Math.abs(cosHalfTheta) >= 1.0) {
        if (out !== a) {
            out[0] = ax;
            out[1] = ay;
            out[2] = az;
            out[3] = aw;
        }
        return out;
    }

    halfTheta = Math.acos(cosHalfTheta);
    sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    if (Math.abs(sinHalfTheta) < 0.001) {
        out[0] = (ax * 0.5 + bx * 0.5);
        out[1] = (ay * 0.5 + by * 0.5);
        out[2] = (az * 0.5 + bz * 0.5);
        out[3] = (aw * 0.5 + bw * 0.5);
        return out;
    }

    ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    out[0] = (ax * ratioA + bx * ratioB);
    out[1] = (ay * ratioA + by * ratioB);
    out[2] = (az * ratioA + bz * ratioB);
    out[3] = (aw * ratioA + bw * ratioB);

    return out;
};

/**
 * Calculates the inverse of a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate inverse of
 * @returns {quat} out
 */
quat.invert = function(out, a) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3],
        dot = a0*a0 + a1*a1 + a2*a2 + a3*a3,
        invDot = dot ? 1.0/dot : 0;
    
    // TODO: Would be faster to return [0,0,0,0] immediately if dot == 0

    out[0] = -a0*invDot;
    out[1] = -a1*invDot;
    out[2] = -a2*invDot;
    out[3] = a3*invDot;
    return out;
};

/**
 * Calculates the conjugate of a quat
 * If the quaternion is normalized, this function is faster than quat.inverse and produces the same result.
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quat to calculate conjugate of
 * @returns {quat} out
 */
quat.conjugate = function (out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = a[3];
    return out;
};

/**
 * Calculates the length of a quat
 *
 * @param {quat} a vector to calculate length of
 * @returns {Number} length of a
 * @function
 */
quat.length = vec4.length;

/**
 * Alias for {@link quat.length}
 * @function
 */
quat.len = quat.length;

/**
 * Calculates the squared length of a quat
 *
 * @param {quat} a vector to calculate squared length of
 * @returns {Number} squared length of a
 * @function
 */
quat.squaredLength = vec4.squaredLength;

/**
 * Alias for {@link quat.squaredLength}
 * @function
 */
quat.sqrLen = quat.squaredLength;

/**
 * Normalize a quat
 *
 * @param {quat} out the receiving quaternion
 * @param {quat} a quaternion to normalize
 * @returns {quat} out
 * @function
 */
quat.normalize = vec4.normalize;

/**
 * Creates a quaternion from the given 3x3 rotation matrix.
 *
 * @param {quat} out the receiving quaternion
 * @param {mat3} m rotation matrix
 * @returns {quat} out
 * @function
 */
quat.fromMat3 = (function() {
    var s_iNext = [1,2,0];
    return function(out, m) {
        // Algorithm in Ken Shoemake's article in 1987 SIGGRAPH course notes
        // article "Quaternion Calculus and Fast Animation".
        var fTrace = m[0] + m[4] + m[8];
        var fRoot;

        if ( fTrace > 0.0 ) {
            // |w| > 1/2, may as well choose w > 1/2
            fRoot = Math.sqrt(fTrace + 1.0);  // 2w
            out[3] = 0.5 * fRoot;
            fRoot = 0.5/fRoot;  // 1/(4w)
            out[0] = (m[7]-m[5])*fRoot;
            out[1] = (m[2]-m[6])*fRoot;
            out[2] = (m[3]-m[1])*fRoot;
        } else {
            // |w| <= 1/2
            var i = 0;
            if ( m[4] > m[0] )
              i = 1;
            if ( m[8] > m[i*3+i] )
              i = 2;
            var j = s_iNext[i];
            var k = s_iNext[j];
            
            fRoot = Math.sqrt(m[i*3+i]-m[j*3+j]-m[k*3+k] + 1.0);
            out[i] = 0.5 * fRoot;
            fRoot = 0.5 / fRoot;
            out[3] = (m[k*3+j] - m[j*3+k]) * fRoot;
            out[j] = (m[j*3+i] + m[i*3+j]) * fRoot;
            out[k] = (m[k*3+i] + m[i*3+k]) * fRoot;
        }
        
        return out;
    };
})();

/**
 * Returns a string representation of a quatenion
 *
 * @param {quat} vec vector to represent as a string
 * @returns {String} string representation of the vector
 */
quat.str = function (a) {
    return 'quat(' + a[0] + ', ' + a[1] + ', ' + a[2] + ', ' + a[3] + ')';
};

if(typeof(exports) !== 'undefined') {
    exports.quat = quat;
}
;













  })(shim.exports);
})();

},{}],40:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"dup":13}],41:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./do-bind.js":40,"dup":14}],42:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"./do-bind.js":40,"dup":15}],43:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],44:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":43}],45:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./lib/vao-emulated.js":41,"./lib/vao-native.js":42,"dup":18,"webglew":44}],46:[function(require,module,exports){
"use strict"

module.exports = fastTwoSum

function fastTwoSum(a, b, result) {
	var x = a + b
	var bv = x - a
	var av = x - bv
	var br = b - bv
	var ar = a - av
	if(result) {
		result[0] = ar + br
		result[1] = x
		return result
	}
	return [ar+br, x]
}
},{}],47:[function(require,module,exports){
"use strict"

var twoProduct = require("two-product")
var twoSum = require("two-sum")

module.exports = scaleLinearExpansion

function scaleLinearExpansion(e, scale) {
  var n = e.length
  if(n === 1) {
    var ts = twoProduct(e[0], scale)
    if(ts[0]) {
      return ts
    }
    return [ ts[1] ]
  }
  var g = new Array(2 * n)
  var q = [0.1, 0.1]
  var t = [0.1, 0.1]
  var count = 0
  twoProduct(e[0], scale, q)
  if(q[0]) {
    g[count++] = q[0]
  }
  for(var i=1; i<n; ++i) {
    twoProduct(e[i], scale, t)
    var pq = q[1]
    twoSum(pq, t[0], q)
    if(q[0]) {
      g[count++] = q[0]
    }
    var a = t[1]
    var b = q[1]
    var x = a + b
    var bv = x - a
    var y = b - bv
    q[1] = x
    if(y) {
      g[count++] = y
    }
  }
  if(q[1]) {
    g[count++] = q[1]
  }
  if(count === 0) {
    g[count++] = 0.0
  }
  g.length = count
  return g
}
},{"two-product":50,"two-sum":46}],48:[function(require,module,exports){
"use strict"

module.exports = robustSubtract

//Easy case: Add two scalars
function scalarScalar(a, b) {
  var x = a + b
  var bv = x - a
  var av = x - bv
  var br = b - bv
  var ar = a - av
  var y = ar + br
  if(y) {
    return [y, x]
  }
  return [x]
}

function robustSubtract(e, f) {
  var ne = e.length|0
  var nf = f.length|0
  if(ne === 1 && nf === 1) {
    return scalarScalar(e[0], -f[0])
  }
  var n = ne + nf
  var g = new Array(n)
  var count = 0
  var eptr = 0
  var fptr = 0
  var abs = Math.abs
  var ei = e[eptr]
  var ea = abs(ei)
  var fi = -f[fptr]
  var fa = abs(fi)
  var a, b
  if(ea < fa) {
    b = ei
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
      ea = abs(ei)
    }
  } else {
    b = fi
    fptr += 1
    if(fptr < nf) {
      fi = -f[fptr]
      fa = abs(fi)
    }
  }
  if((eptr < ne && ea < fa) || (fptr >= nf)) {
    a = ei
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
      ea = abs(ei)
    }
  } else {
    a = fi
    fptr += 1
    if(fptr < nf) {
      fi = -f[fptr]
      fa = abs(fi)
    }
  }
  var x = a + b
  var bv = x - a
  var y = b - bv
  var q0 = y
  var q1 = x
  var _x, _bv, _av, _br, _ar
  while(eptr < ne && fptr < nf) {
    if(ea < fa) {
      a = ei
      eptr += 1
      if(eptr < ne) {
        ei = e[eptr]
        ea = abs(ei)
      }
    } else {
      a = fi
      fptr += 1
      if(fptr < nf) {
        fi = -f[fptr]
        fa = abs(fi)
      }
    }
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    }
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
  }
  while(eptr < ne) {
    a = ei
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    }
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
    }
  }
  while(fptr < nf) {
    a = fi
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    } 
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
    fptr += 1
    if(fptr < nf) {
      fi = -f[fptr]
    }
  }
  if(q0) {
    g[count++] = q0
  }
  if(q1) {
    g[count++] = q1
  }
  if(!count) {
    g[count++] = 0.0  
  }
  g.length = count
  return g
}
},{}],49:[function(require,module,exports){
"use strict"

module.exports = linearExpansionSum

//Easy case: Add two scalars
function scalarScalar(a, b) {
  var x = a + b
  var bv = x - a
  var av = x - bv
  var br = b - bv
  var ar = a - av
  var y = ar + br
  if(y) {
    return [y, x]
  }
  return [x]
}

function linearExpansionSum(e, f) {
  var ne = e.length|0
  var nf = f.length|0
  if(ne === 1 && nf === 1) {
    return scalarScalar(e[0], f[0])
  }
  var n = ne + nf
  var g = new Array(n)
  var count = 0
  var eptr = 0
  var fptr = 0
  var abs = Math.abs
  var ei = e[eptr]
  var ea = abs(ei)
  var fi = f[fptr]
  var fa = abs(fi)
  var a, b
  if(ea < fa) {
    b = ei
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
      ea = abs(ei)
    }
  } else {
    b = fi
    fptr += 1
    if(fptr < nf) {
      fi = f[fptr]
      fa = abs(fi)
    }
  }
  if((eptr < ne && ea < fa) || (fptr >= nf)) {
    a = ei
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
      ea = abs(ei)
    }
  } else {
    a = fi
    fptr += 1
    if(fptr < nf) {
      fi = f[fptr]
      fa = abs(fi)
    }
  }
  var x = a + b
  var bv = x - a
  var y = b - bv
  var q0 = y
  var q1 = x
  var _x, _bv, _av, _br, _ar
  while(eptr < ne && fptr < nf) {
    if(ea < fa) {
      a = ei
      eptr += 1
      if(eptr < ne) {
        ei = e[eptr]
        ea = abs(ei)
      }
    } else {
      a = fi
      fptr += 1
      if(fptr < nf) {
        fi = f[fptr]
        fa = abs(fi)
      }
    }
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    }
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
  }
  while(eptr < ne) {
    a = ei
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    }
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
    eptr += 1
    if(eptr < ne) {
      ei = e[eptr]
    }
  }
  while(fptr < nf) {
    a = fi
    b = q0
    x = a + b
    bv = x - a
    y = b - bv
    if(y) {
      g[count++] = y
    } 
    _x = q1 + x
    _bv = _x - q1
    _av = _x - _bv
    _br = x - _bv
    _ar = q1 - _av
    q0 = _ar + _br
    q1 = _x
    fptr += 1
    if(fptr < nf) {
      fi = f[fptr]
    }
  }
  if(q0) {
    g[count++] = q0
  }
  if(q1) {
    g[count++] = q1
  }
  if(!count) {
    g[count++] = 0.0  
  }
  g.length = count
  return g
}
},{}],50:[function(require,module,exports){
"use strict"

module.exports = twoProduct

var SPLITTER = +(Math.pow(2, 27) + 1.0)

function twoProduct(a, b, result) {
  var x = a * b

  var c = SPLITTER * a
  var abig = c - a
  var ahi = c - abig
  var alo = a - ahi

  var d = SPLITTER * b
  var bbig = d - b
  var bhi = d - bbig
  var blo = b - bhi

  var err1 = x - (ahi * bhi)
  var err2 = err1 - (alo * bhi)
  var err3 = err2 - (ahi * blo)

  var y = alo * blo - err3

  if(result) {
    result[0] = y
    result[1] = x
    return result
  }

  return [ y, x ]
}
},{}],51:[function(require,module,exports){
"use strict"

var twoProduct = require("two-product")
var robustSum = require("robust-sum")
var robustScale = require("robust-scale")
var robustSubtract = require("robust-subtract")

var NUM_EXPAND = 5

var EPSILON     = 1.1102230246251565e-16
var ERRBOUND3   = (3.0 + 16.0 * EPSILON) * EPSILON
var ERRBOUND4   = (7.0 + 56.0 * EPSILON) * EPSILON

function cofactor(m, c) {
  var result = new Array(m.length-1)
  for(var i=1; i<m.length; ++i) {
    var r = result[i-1] = new Array(m.length-1)
    for(var j=0,k=0; j<m.length; ++j) {
      if(j === c) {
        continue
      }
      r[k++] = m[i][j]
    }
  }
  return result
}

function matrix(n) {
  var result = new Array(n)
  for(var i=0; i<n; ++i) {
    result[i] = new Array(n)
    for(var j=0; j<n; ++j) {
      result[i][j] = ["m", j, "[", (n-i-1), "]"].join("")
    }
  }
  return result
}

function sign(n) {
  if(n & 1) {
    return "-"
  }
  return ""
}

function generateSum(expr) {
  if(expr.length === 1) {
    return expr[0]
  } else if(expr.length === 2) {
    return ["sum(", expr[0], ",", expr[1], ")"].join("")
  } else {
    var m = expr.length>>1
    return ["sum(", generateSum(expr.slice(0, m)), ",", generateSum(expr.slice(m)), ")"].join("")
  }
}

function determinant(m) {
  if(m.length === 2) {
    return [["sum(prod(", m[0][0], ",", m[1][1], "),prod(-", m[0][1], ",", m[1][0], "))"].join("")]
  } else {
    var expr = []
    for(var i=0; i<m.length; ++i) {
      expr.push(["scale(", generateSum(determinant(cofactor(m, i))), ",", sign(i), m[0][i], ")"].join(""))
    }
    return expr
  }
}

function orientation(n) {
  var pos = []
  var neg = []
  var m = matrix(n)
  var args = []
  for(var i=0; i<n; ++i) {
    if((i&1)===0) {
      pos.push.apply(pos, determinant(cofactor(m, i)))
    } else {
      neg.push.apply(neg, determinant(cofactor(m, i)))
    }
    args.push("m" + i)
  }
  var posExpr = generateSum(pos)
  var negExpr = generateSum(neg)
  var funcName = "orientation" + n + "Exact"
  var code = ["function ", funcName, "(", args.join(), "){var p=", posExpr, ",n=", negExpr, ",d=sub(p,n);\
return d[d.length-1];};return ", funcName].join("")
  var proc = new Function("sum", "prod", "scale", "sub", code)
  return proc(robustSum, twoProduct, robustScale, robustSubtract)
}

var orientation3Exact = orientation(3)
var orientation4Exact = orientation(4)

var CACHED = [
  function orientation0() { return 0 },
  function orientation1() { return 0 },
  function orientation2(a, b) { 
    return b[0] - a[0]
  },
  function orientation3(a, b, c) {
    var l = (a[1] - c[1]) * (b[0] - c[0])
    var r = (a[0] - c[0]) * (b[1] - c[1])
    var det = l - r
    var s
    if(l > 0) {
      if(r <= 0) {
        return det
      } else {
        s = l + r
      }
    } else if(l < 0) {
      if(r >= 0) {
        return det
      } else {
        s = -(l + r)
      }
    } else {
      return det
    }
    var tol = ERRBOUND3 * s
    if(det >= tol || det <= -tol) {
      return det
    }
    return orientation3Exact(a, b, c)
  },
  function orientation4(a,b,c,d) {
    var adx = a[0] - d[0]
    var bdx = b[0] - d[0]
    var cdx = c[0] - d[0]
    var ady = a[1] - d[1]
    var bdy = b[1] - d[1]
    var cdy = c[1] - d[1]
    var adz = a[2] - d[2]
    var bdz = b[2] - d[2]
    var cdz = c[2] - d[2]
    var bdxcdy = bdx * cdy
    var cdxbdy = cdx * bdy
    var cdxady = cdx * ady
    var adxcdy = adx * cdy
    var adxbdy = adx * bdy
    var bdxady = bdx * ady
    var det = adz * (bdxcdy - cdxbdy) 
            + bdz * (cdxady - adxcdy)
            + cdz * (adxbdy - bdxady)
    var permanent = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * Math.abs(adz)
                  + (Math.abs(cdxady) + Math.abs(adxcdy)) * Math.abs(bdz)
                  + (Math.abs(adxbdy) + Math.abs(bdxady)) * Math.abs(cdz)
    var tol = ERRBOUND4 * permanent
    if ((det > tol) || (-det > tol)) {
      return det
    }
    return orientation4Exact(a,b,c,d)
  }
]

function slowOrient(args) {
  var proc = CACHED[args.length]
  if(!proc) {
    proc = CACHED[args.length] = orientation(args.length)
  }
  return proc.apply(undefined, args)
}

function generateOrientationProc() {
  while(CACHED.length <= NUM_EXPAND) {
    CACHED.push(orientation(CACHED.length))
  }
  var args = []
  var procArgs = ["slow"]
  for(var i=0; i<=NUM_EXPAND; ++i) {
    args.push("a" + i)
    procArgs.push("o" + i)
  }
  var code = [
    "function getOrientation(", args.join(), "){switch(arguments.length){case 0:case 1:return 0;"
  ]
  for(var i=2; i<=NUM_EXPAND; ++i) {
    code.push("case ", i, ":return o", i, "(", args.slice(0, i).join(), ");")
  }
  code.push("}var s=new Array(arguments.length);for(var i=0;i<arguments.length;++i){s[i]=arguments[i]};return slow(s);}return getOrientation")
  procArgs.push(code.join(""))

  var proc = Function.apply(undefined, procArgs)
  module.exports = proc.apply(undefined, [slowOrient].concat(CACHED))
  for(var i=0; i<=NUM_EXPAND; ++i) {
    module.exports[i] = CACHED[i]
  }
}

generateOrientationProc()
},{"robust-scale":47,"robust-subtract":48,"robust-sum":49,"two-product":50}],52:[function(require,module,exports){
"use strict"

var robustDot = require("robust-dot-product")
var robustSum = require("robust-sum")

module.exports = splitPolygon
module.exports.positive = positive
module.exports.negative = negative

function planeT(p, plane) {
  var r = robustSum(robustDot(p, plane), [plane[plane.length-1]])
  return r[r.length-1]
}


//Can't do this exactly and emit a floating point result
function lerpW(a, wa, b, wb) {
  var d = wb - wa
  var t = -wa / d
  if(t < 0.0) {
    t = 0.0
  } else if(t > 1.0) {
    t = 1.0
  }
  var ti = 1.0 - t
  var n = a.length
  var r = new Array(n)
  for(var i=0; i<n; ++i) {
    r[i] = t * a[i] + ti * b[i]
  }
  return r
}

function splitPolygon(points, plane) {
  var pos = []
  var neg = []
  var a = planeT(points[points.length-1], plane)
  for(var s=points[points.length-1], t=points[0], i=0; i<points.length; ++i, s=t) {
    t = points[i]
    var b = planeT(t, plane)
    if((a < 0 && b > 0) || (a > 0 && b < 0)) {
      var p = lerpW(s, b, t, a)
      pos.push(p)
      neg.push(p.slice())
    }
    if(b < 0) {
      neg.push(t.slice())
    } else if(b > 0) {
      pos.push(t.slice())
    } else {
      pos.push(t.slice())
      neg.push(t.slice())
    }
    a = b
  }
  return { positive: pos, negative: neg }
}

function positive(points, plane) {
  var pos = []
  var a = planeT(points[points.length-1], plane)
  for(var s=points[points.length-1], t=points[0], i=0; i<points.length; ++i, s=t) {
    t = points[i]
    var b = planeT(t, plane)
    if((a < 0 && b > 0) || (a > 0 && b < 0)) {
      pos.push(lerpW(s, b, t, a))
    }
    if(b >= 0) {
      pos.push(t.slice())
    }
    a = b
  }
  return pos
}

function negative(points, plane) {
  var neg = []
  var a = planeT(points[points.length-1], plane)
  for(var s=points[points.length-1], t=points[0], i=0; i<points.length; ++i, s=t) {
    t = points[i]
    var b = planeT(t, plane)
    if((a < 0 && b > 0) || (a > 0 && b < 0)) {
      neg.push(lerpW(s, b, t, a))
    }
    if(b <= 0) {
      neg.push(t.slice())
    }
    a = b
  }
  return neg
}
},{"robust-dot-product":53,"robust-sum":55}],53:[function(require,module,exports){
"use strict"

var twoProduct = require("two-product")
var robustSum = require("robust-sum")

module.exports = robustDotProduct

function robustDotProduct(a, b) {
  var r = twoProduct(a[0], b[0])
  for(var i=1; i<a.length; ++i) {
    r = robustSum(r, twoProduct(a[i], b[i]))
  }
  return r
}
},{"robust-sum":55,"two-product":54}],54:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],55:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"dup":49}],56:[function(require,module,exports){
"use strict"

module.exports = createText

var vectorizeText = require("./lib/vtext")
var Canvas = require("canvas-browserify")
var canvas = new Canvas(8192, 256)
var context = canvas.getContext("2d")

function createText(str, options) {
  if((typeof options !== "object") || (options === null)) {
    options = {}
  }
  return vectorizeText(str, canvas, context, options)
}
},{"./lib/vtext":57,"canvas-browserify":58}],57:[function(require,module,exports){
"use strict"

module.exports = vectorizeText
module.exports.processPixels = processPixels

var surfaceNets = require("surface-nets")
var ndarray = require("ndarray")
var simplify = require("simplify-planar-graph")
var toPolygons = require("planar-graph-to-polyline")
var triangulate = require("triangulate-polyline")

function transformPositions(positions, options, size) {
  var align = options.textAlign || "start"
  var baseline = options.textBaseline || "alphabetic"

  var lo = [1<<30, 1<<30]
  var hi = [0,0]
  var n = positions.length
  for(var i=0; i<n; ++i) {
    var p = positions[i]
    for(var j=0; j<2; ++j) {
      lo[j] = Math.min(lo[j], p[j])|0
      hi[j] = Math.max(hi[j], p[j])|0
    }
  }

  var xShift = 0
  switch(align) {
    case "center":
      xShift = -0.5 * (lo[0] + hi[0])
    break

    case "right":
    case "end":
      xShift = -hi[0]
    break

    case "left":
    case "start":
      xShift = -lo[0]
    break

    default:
      throw new Error("vectorize-text: Unrecognized textAlign: '" + align + "'")
  }

  var yShift = 0
  switch(baseline) {
    case "hanging":
    case "top":
      yShift = -lo[1]
    break

    case "middle":
      yShift = -0.5 * (lo[1] + hi[1])
    break

    case "alphabetic":
    case "ideographic":
      yShift = -3 * size
    break

    case "bottom":
      yShift = -hi[1]
    break

    default:
      throw new Error("vectorize-text: Unrecoginized textBaseline: '" + baseline + "'")
  }

  var scale = 1.0 / size
  if("lineHeight" in options) {
    scale *= +options.lineHeight
  } else if("width" in options) {
    scale = options.width / (hi[0] - lo[0])
  } else if("height" in options) {
    scale = options.height / (hi[1] - lo[1])
  }

  return positions.map(function(p) {
    return [ scale * (p[0] + xShift), scale * (p[1] + yShift) ]
  })
}



function getPixels(canvas, context, str, size) {
  var width = Math.ceil(context.measureText(str).width + 10)|0
  if(width > 8192) {
    throw new Error("vectorize-text: String too long (sorry, this will get fixed later)")
  }
  var height = 4 * size
  if(canvas.height < height) {
    canvas.height = height
  }

  context.fillStyle = "#000"
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.fillStyle = "#fff"
  context.fillText(str, 5, (3 * size)|0)

  //Cut pixels from image  
  var pixelData = context.getImageData(0, 0, width, height)
  var pixels = ndarray(pixelData.data, [height, width, 4])

  return pixels.pick(-1,-1,0).transpose(1,0)
}

function getContour(pixels, doSimplify) {
  var contour = surfaceNets(pixels, 128)
  if(doSimplify) {
    return simplify(contour.cells, contour.positions, 0.25)
  }
  return { 
    edges: contour.cells, 
    positions: contour.positions 
  }
}

function processPixelsImpl(pixels, options, size, simplify) {
  //Extract contour
  var contour = getContour(pixels, simplify)

  //Apply warp to positions
  var npositions = transformPositions(contour.positions, options, size)
  var flip = "ccw" === options.orientation

  //If triangulate flag passed, triangulate the result
  if(options.polygons || options.polygon || options.polyline) {
    var polygons = toPolygons(contour.edges, contour.positions)
    return polygons.map(function(polygon) {
      if(flip) {
        polygon.reverse()
      }
      return polygon.map(function(loop) {
        return loop.map(function(v) {
          return npositions[v]
        })
      })
    })
  } else if(options.triangles || options.triangulate || options.triangle) {
    var polygons = toPolygons(contour.edges, contour.positions)
    var triangles = []
    for(var i=0; i<polygons.length; ++i) {
      triangles.push.apply(triangles, triangulate(polygons[i], contour.positions))
    }
    if(flip) {
      for(var i=0; i<triangles.length; ++i) {
        var c = triangles[i]
        var tmp = c[0]
        c[0] = c[2]
        c[2] = tmp
      }
    }
    return {
      cells: triangles,
      positions: npositions
    }
  } else {
    return {
      edges: contour.edges,
      positions: npositions
    }
  }
}

function processPixels(pixels, options, size) {
  try {
    return processPixelsImpl(pixels, options, size, true)
  } catch(e) {}
  try {
    return processPixelsImpl(pixels, options, size, false)
  } catch(e) {}
  if(options.polygons || options.polyline || options.polygon) {
    return []
  }
  if(options.triangles || options.triangulate || options.triangle) {
    return {
      cells: [],
      positions: []
    }
  }
  return {
    edges: [],
    positions: []
  }
}

function vectorizeText(str, canvas, context, options) {
  var size = options.size || 64
  var family = options.font || "normal"

  context.font = size + "px " + family
  context.textAlign = "start"
  context.textBaseline = "alphabetic"
  context.direction = "ltr"

  var pixels = getPixels(canvas, context, str, size)

  return processPixels(pixels, options, size)
}
},{"ndarray":247,"planar-graph-to-polyline":76,"simplify-planar-graph":80,"surface-nets":96,"triangulate-polyline":107}],58:[function(require,module,exports){

var Canvas = module.exports = function Canvas (w, h) {
  var canvas = document.createElement('canvas')
  canvas.width = w || 300
  canvas.height = h || 150
  return canvas
}

Canvas.Image = function () {
  var img = document.createElement('img')
  return img
}




},{}],59:[function(require,module,exports){
'use strict'

module.exports = trimLeaves

var e2a = require('edges-to-adjacency-list')

function trimLeaves(edges, positions) {
  var adj = e2a(edges, positions.length)
  var live = new Array(positions.length)
  var nbhd = new Array(positions.length)

  var dead = []
  for(var i=0; i<positions.length; ++i) {
    var count = adj[i].length
    nbhd[i] = count
    live[i] = true
    if(count <= 1) {
      dead.push(i)
    }
  }

  while(dead.length > 0) {
    var v = dead.pop()
    live[v] = false
    var n = adj[v]
    for(var i=0; i<n.length; ++i) {
      var u = n[i]
      if(--nbhd[u] === 0) {
        dead.push(u)
      }
    }
  }

  var newIndex = new Array(positions.length)
  var npositions = []
  for(var i=0; i<positions.length; ++i) {
    if(live[i]) {
      var v = npositions.length
      newIndex[i] = v
      npositions.push(positions[i])
    } else {
      newIndex[i] = -1
    }
  }

  var nedges = []
  for(var i=0; i<edges.length; ++i) {
    var e = edges[i]
    if(live[e[0]] && live[e[1]]) {
      nedges.push([ newIndex[e[0]], newIndex[e[1]] ])
    }
  }
  
  return [ nedges, npositions ]
}
},{"edges-to-adjacency-list":60}],60:[function(require,module,exports){
"use strict"

module.exports = edgeToAdjacency

var uniq = require("uniq")

function edgeToAdjacency(edges, numVertices) {
  var numEdges = edges.length
  if(typeof numVertices !== "number") {
    numVertices = 0
    for(var i=0; i<numEdges; ++i) {
      var e = edges[i]
      numVertices = Math.max(numVertices, e[0], e[1])
    }
    numVertices = (numVertices|0) + 1
  }
  numVertices = numVertices|0
  var adj = new Array(numVertices)
  for(var i=0; i<numVertices; ++i) {
    adj[i] = []
  }
  for(var i=0; i<numEdges; ++i) {
    var e = edges[i]
    adj[e[0]].push(e[1])
    adj[e[1]].push(e[0])
  }
  for(var j=0; j<numVertices; ++j) {
    uniq(adj[j], function(a, b) {
      return a - b
    })
  }
  return adj
}
},{"uniq":75}],61:[function(require,module,exports){
"use strict"

module.exports = planarDual

var compareAngle = require("compare-angle")

function planarDual(cells, positions) {

  var numVertices = positions.length|0
  var numEdges = cells.length
  var adj = [new Array(numVertices), new Array(numVertices)]
  for(var i=0; i<numVertices; ++i) {
    adj[0][i] = []
    adj[1][i] = []
  }
  for(var i=0; i<numEdges; ++i) {
    var c = cells[i]
    adj[0][c[0]].push(c)
    adj[1][c[1]].push(c)
  }

  var cycles = []

  //Add isolated vertices as trivial case
  for(var i=0; i<numVertices; ++i) {
    if(adj[0][i].length + adj[1][i].length === 0) {
      cycles.push( [i] )
    }
  }

  //Remove a half edge
  function cut(c, i) {
    var a = adj[i][c[i]]
    a.splice(a.indexOf(c), 1)
  }

  //Find next vertex and cut edge
  function next(a, b, noCut) {
    var nextCell, nextVertex, nextDir
    for(var i=0; i<2; ++i) {
      if(adj[i][b].length > 0) {
        nextCell = adj[i][b][0]
        nextDir = i
        break
      }
    }
    nextVertex = nextCell[nextDir^1]

    for(var dir=0; dir<2; ++dir) {
      var nbhd = adj[dir][b]
      for(var k=0; k<nbhd.length; ++k) {
        var e = nbhd[k]
        var p = e[dir^1]
        var cmp = compareAngle(
            positions[a], 
            positions[b], 
            positions[nextVertex],
            positions[p])
        if(cmp > 0) {
          nextCell = e
          nextVertex = p
          nextDir = dir
        }
      }
    }
    if(noCut) {
      return nextVertex
    }
    if(nextCell) {
      cut(nextCell, nextDir)
    }
    return nextVertex
  }

  function extractCycle(v, dir) {
    var e0 = adj[dir][v][0]
    var cycle = [v]
    cut(e0, dir)
    var u = e0[dir^1]
    var d0 = dir
    while(true) {
      while(u !== v) {
        cycle.push(u)
        u = next(cycle[cycle.length-2], u, false)
      }
      if(adj[0][v].length + adj[1][v].length === 0) {
        break
      }
      var a = cycle[cycle.length-1]
      var b = v
      var c = cycle[1]
      var d = next(a, b, true)
      if(compareAngle(positions[a], positions[b], positions[c], positions[d]) < 0) {
        break
      }
      cycle.push(v)
      u = next(a, b)
    }
    return cycle
  }

  function shouldGlue(pcycle, ncycle) {
    return (ncycle[1] === ncycle[ncycle.length-1])
  }

  for(var i=0; i<numVertices; ++i) {
    for(var j=0; j<2; ++j) {
      var pcycle = []
      while(adj[j][i].length > 0) {
        var ni = adj[0][i].length
        var ncycle = extractCycle(i,j)
        if(shouldGlue(pcycle, ncycle)) {
          //Glue together trivial cycles
          pcycle.push.apply(pcycle, ncycle)
        } else {
          if(pcycle.length > 0) {
            cycles.push(pcycle)
          }
          pcycle = ncycle
        }
      }
      if(pcycle.length > 0) {
        cycles.push(pcycle)
      }
    }
  }

  //Combine paths and loops together
  return cycles
}
},{"compare-angle":62}],62:[function(require,module,exports){
"use strict"

module.exports = compareAngle

var orient = require("robust-orientation")
var sgn = require("signum")
var twoSum = require("two-sum")
var robustProduct = require("robust-product")
var robustSum = require("robust-sum")

function testInterior(a, b, c) {
  var x0 = twoSum(a[0], -b[0])
  var y0 = twoSum(a[1], -b[1])
  var x1 = twoSum(c[0], -b[0])
  var y1 = twoSum(c[1], -b[1])

  var d = robustSum(
    robustProduct(x0, x1),
    robustProduct(y0, y1))

  return d[d.length-1] >= 0
}

function compareAngle(a, b, c, d) {
  var bcd = orient(b, c, d)
  if(bcd === 0) {
    //Handle degenerate cases
    var sabc = sgn(orient(a, b, c))
    var sabd = sgn(orient(a, b, d))
    if(sabc === sabd) {
      if(sabc === 0) {
        var ic = testInterior(a, b, c)
        var id = testInterior(a, b, d)
        if(ic === id) {
          return 0
        } else if(ic) {
          return 1
        } else {
          return -1
        }
      }
      return 0
    } else if(sabd === 0) {
      if(sabc > 0) {
        return -1
      } else if(testInterior(a, b, d)) {
        return -1
      } else {
        return 1
      }
    } else if(sabc === 0) {
      if(sabd > 0) {
        return 1
      } else if(testInterior(a, b, c)) {
        return 1
      } else {
        return -1
      }
    }
    return sgn(sabd - sabc)
  }
  var abc = orient(a, b, c)
  if(abc > 0) {
    if(bcd > 0 && orient(a, b, d) > 0) {
      return 1
    }
    return -1
  } else if(abc < 0) {
    if(bcd > 0 || orient(a, b, d) > 0) {
      return 1
    }
    return -1
  } else {
    var abd = orient(a, b, d)
    if(abd > 0) {
      return 1
    } else {
      if(testInterior(a, b, c)) {
        return 1
      } else {
        return -1
      }
    }
  }
}
},{"robust-orientation":51,"robust-product":64,"robust-sum":73,"signum":65,"two-sum":66}],63:[function(require,module,exports){
arguments[4][47][0].apply(exports,arguments)
},{"dup":47,"two-product":74,"two-sum":66}],64:[function(require,module,exports){
"use strict"

var robustSum = require("robust-sum")
var robustScale = require("robust-scale")

module.exports = robustProduct

function robustProduct(a, b) {
  if(a.length === 1) {
    return robustScale(b, a[0])
  }
  if(b.length === 1) {
    return robustScale(a, b[0])
  }
  if(a.length === 0 || b.length === 0) {
    return [0]
  }
  var r = [0]
  if(a.length < b.length) {
    for(var i=0; i<a.length; ++i) {
      r = robustSum(r, robustScale(b, a[i]))
    }
  } else {
    for(var i=0; i<b.length; ++i) {
      r = robustSum(r, robustScale(a, b[i]))
    }    
  }
  return r
}
},{"robust-scale":63,"robust-sum":73}],65:[function(require,module,exports){
"use strict"

module.exports = function signum(x) {
  if(x < 0) { return -1 }
  if(x > 0) { return 1 }
  return 0.0
}
},{}],66:[function(require,module,exports){
arguments[4][46][0].apply(exports,arguments)
},{"dup":46}],67:[function(require,module,exports){
"use strict"

function compileSearch(funcName, predicate, reversed, extraArgs, useNdarray, earlyOut) {
  var code = [
    "function ", funcName, "(a,l,h,", extraArgs.join(","),  "){",
earlyOut ? "" : "var i=", (reversed ? "l-1" : "h+1"),
";while(l<=h){\
var m=(l+h)>>>1,x=a", useNdarray ? ".get(m)" : "[m]"]
  if(earlyOut) {
    if(predicate.indexOf("c") < 0) {
      code.push(";if(x===y){return m}else if(x<=y){")
    } else {
      code.push(";var p=c(x,y);if(p===0){return m}else if(p<=0){")
    }
  } else {
    code.push(";if(", predicate, "){i=m;")
  }
  if(reversed) {
    code.push("l=m+1}else{h=m-1}")
  } else {
    code.push("h=m-1}else{l=m+1}")
  }
  code.push("}")
  if(earlyOut) {
    code.push("return -1};")
  } else {
    code.push("return i};")
  }
  return code.join("")
}

function compileBoundsSearch(predicate, reversed, suffix, earlyOut) {
  var result = new Function([
  compileSearch("A", "x" + predicate + "y", reversed, ["y"], false, earlyOut),
  compileSearch("B", "x" + predicate + "y", reversed, ["y"], true, earlyOut),
  compileSearch("P", "c(x,y)" + predicate + "0", reversed, ["y", "c"], false, earlyOut),
  compileSearch("Q", "c(x,y)" + predicate + "0", reversed, ["y", "c"], true, earlyOut),
"function dispatchBsearch", suffix, "(a,y,c,l,h){\
if(a.shape){\
if(typeof(c)==='function'){\
return Q(a,(l===undefined)?0:l|0,(h===undefined)?a.shape[0]-1:h|0,y,c)\
}else{\
return B(a,(c===undefined)?0:c|0,(l===undefined)?a.shape[0]-1:l|0,y)\
}}else{\
if(typeof(c)==='function'){\
return P(a,(l===undefined)?0:l|0,(h===undefined)?a.length-1:h|0,y,c)\
}else{\
return A(a,(c===undefined)?0:c|0,(l===undefined)?a.length-1:l|0,y)\
}}}\
return dispatchBsearch", suffix].join(""))
  return result()
}

module.exports = {
  ge: compileBoundsSearch(">=", false, "GE"),
  gt: compileBoundsSearch(">", false, "GT"),
  lt: compileBoundsSearch("<", true, "LT"),
  le: compileBoundsSearch("<=", true, "LE"),
  eq: compileBoundsSearch("-", true, "EQ", true)
}

},{}],68:[function(require,module,exports){
"use strict"

var bounds = require("binary-search-bounds")

var NOT_FOUND = 0
var SUCCESS = 1
var EMPTY = 2

module.exports = createWrapper

function IntervalTreeNode(mid, left, right, leftPoints, rightPoints) {
  this.mid = mid
  this.left = left
  this.right = right
  this.leftPoints = leftPoints
  this.rightPoints = rightPoints
  this.count = (left ? left.count : 0) + (right ? right.count : 0) + leftPoints.length
}

var proto = IntervalTreeNode.prototype

function copy(a, b) {
  a.mid = b.mid
  a.left = b.left
  a.right = b.right
  a.leftPoints = b.leftPoints
  a.rightPoints = b.rightPoints
  a.count = b.count
}

function rebuild(node, intervals) {
  var ntree = createIntervalTree(intervals)
  node.mid = ntree.mid
  node.left = ntree.left
  node.right = ntree.right
  node.leftPoints = ntree.leftPoints
  node.rightPoints = ntree.rightPoints
  node.count = ntree.count
}

function rebuildWithInterval(node, interval) {
  var intervals = node.intervals([])
  intervals.push(interval)
  rebuild(node, intervals)    
}

function rebuildWithoutInterval(node, interval) {
  var intervals = node.intervals([])
  var idx = intervals.indexOf(interval)
  if(idx < 0) {
    return NOT_FOUND
  }
  intervals.splice(idx, 1)
  rebuild(node, intervals)
  return SUCCESS
}

proto.intervals = function(result) {
  result.push.apply(result, this.leftPoints)
  if(this.left) {
    this.left.intervals(result)
  }
  if(this.right) {
    this.right.intervals(result)
  }
  return result
}

proto.insert = function(interval) {
  var weight = this.count - this.leftPoints.length
  this.count += 1
  if(interval[1] < this.mid) {
    if(this.left) {
      if(4*(this.left.count+1) > 3*(weight+1)) {
        rebuildWithInterval(this, interval)
      } else {
        this.left.insert(interval)
      }
    } else {
      this.left = createIntervalTree([interval])
    }
  } else if(interval[0] > this.mid) {
    if(this.right) {
      if(4*(this.right.count+1) > 3*(weight+1)) {
        rebuildWithInterval(this, interval)
      } else {
        this.right.insert(interval)
      }
    } else {
      this.right = createIntervalTree([interval])
    }
  } else {
    var l = bounds.ge(this.leftPoints, interval, compareBegin)
    var r = bounds.ge(this.rightPoints, interval, compareEnd)
    this.leftPoints.splice(l, 0, interval)
    this.rightPoints.splice(r, 0, interval)
  }
}

proto.remove = function(interval) {
  var weight = this.count - this.leftPoints
  if(interval[1] < this.mid) {
    if(!this.left) {
      return NOT_FOUND
    }
    var rw = this.right ? this.right.count : 0
    if(4 * rw > 3 * (weight-1)) {
      return rebuildWithoutInterval(this, interval)
    }
    var r = this.left.remove(interval)
    if(r === EMPTY) {
      this.left = null
      this.count -= 1
      return SUCCESS
    } else if(r === SUCCESS) {
      this.count -= 1
    }
    return r
  } else if(interval[0] > this.mid) {
    if(!this.right) {
      return NOT_FOUND
    }
    var lw = this.left ? this.left.count : 0
    if(4 * lw > 3 * (weight-1)) {
      return rebuildWithoutInterval(this, interval)
    }
    var r = this.right.remove(interval)
    if(r === EMPTY) {
      this.right = null
      this.count -= 1
      return SUCCESS
    } else if(r === SUCCESS) {
      this.count -= 1
    }
    return r
  } else {
    if(this.count === 1) {
      if(this.leftPoints[0] === interval) {
        return EMPTY
      } else {
        return NOT_FOUND
      }
    }
    if(this.leftPoints.length === 1 && this.leftPoints[0] === interval) {
      if(this.left && this.right) {
        var p = this
        var n = this.left
        while(n.right) {
          p = n
          n = n.right
        }
        if(p === this) {
          n.right = this.right
        } else {
          var l = this.left
          var r = this.right
          p.count -= n.count
          p.right = n.left
          n.left = l
          n.right = r
        }
        copy(this, n)
        this.count = (this.left?this.left.count:0) + (this.right?this.right.count:0) + this.leftPoints.length
      } else if(this.left) {
        copy(this, this.left)
      } else {
        copy(this, this.right)
      }
      return SUCCESS
    }
    for(var l = bounds.ge(this.leftPoints, interval, compareBegin); l<this.leftPoints.length; ++l) {
      if(this.leftPoints[l][0] !== interval[0]) {
        break
      }
      if(this.leftPoints[l] === interval) {
        this.count -= 1
        this.leftPoints.splice(l, 1)
        for(var r = bounds.ge(this.rightPoints, interval, compareEnd); r<this.rightPoints.length; ++r) {
          if(this.rightPoints[r][1] !== interval[1]) {
            break
          } else if(this.rightPoints[r] === interval) {
            this.rightPoints.splice(r, 1)
            return SUCCESS
          }
        }
      }
    }
    return NOT_FOUND
  }
}

function compareXBegin(x, y) {
  return x[0] - y
}

function compareXEnd(x, y) {
  return x[1] - y
}

proto.queryPoint = function(x, cb) {
  if(x < this.mid) {
    if(this.left) {
      var r = this.left.queryPoint(x, cb)
      if(r) { return r }
    }
    var i = bounds.le(this.leftPoints, x, compareXBegin)
    for(; i>=0; --i) {
      var r = cb(this.leftPoints[i])
      if(r) { return r }
    }
  } else if(x > this.mid) {
    var i = bounds.ge(this.rightPoints, x, compareXEnd)
    for(; i<this.rightPoints.length; ++i) {
      var r = cb(this.rightPoints[i])
      if(r) { return r}
    }
    if(this.right) {
      var r = this.right.queryPoint(x, cb)
      if(r) { return r }
    }
  } else {
    for(var i=0; i<this.leftPoints.length; ++i) {
      var r = cb(this.leftPoints[i])
      if(r) { return r }
    }
  }
}

function reportLeftRange(arr, lo, hi, cb) {
  var b = bounds.gt(arr, hi, compareXBegin)
  for(var i=0; i<b; ++i) {
    var r = cb(arr[i])
    if(r) { return r }
  }
}

function reportRightRange(arr, lo, hi, cb) {
  var a = bounds.ge(arr, lo, compareXEnd)
  var b = arr.length
  for(var i=a; i<b; ++i) {
    var r = cb(arr[i])
    if(r) { return r }
  }
}

proto.queryInterval = function(lo, hi, cb) {
  if(lo < this.mid && this.left) {
    var r = this.left.queryInterval(lo, hi, cb)
    if(r) { return r }
  }
  if(hi > this.mid && this.right) {
    var r = this.right.queryInterval(lo, hi, cb)
    if(r) { return r }
  }
  if(hi < this.mid) {
    var r = reportLeftRange(this.leftPoints, lo, hi, cb)
    if(r) { return r }
  } else if(lo > this.mid) {
    var r = reportRightRange(this.rightPoints, lo, hi, cb)
    if(r) { return r }
  } else {
    for(var i=0; i<this.leftPoints.length; ++i) {
      var r = cb(this.leftPoints[i])
      if(r) { return r }
    }
  }
}

function compareNumbers(a, b) {
  return a - b
}

function compareBegin(a, b) {
  var d = a[0] - b[0]
  if(d) { return d }
  return a[1] - b[1]
}

function compareEnd(a, b) {
  var d = a[1] - b[1]
  if(d) { return d }
  return a[0] - b[0]
}

function createIntervalTree(intervals) {
  if(intervals.length === 0) {
    return null
  }
  var pts = []
  for(var i=0; i<intervals.length; ++i) {
    pts.push(intervals[i][0], intervals[i][1])
  }
  pts.sort(compareNumbers)

  var mid = pts[pts.length>>1]

  var leftIntervals = []
  var rightIntervals = []
  var centerIntervals = []
  for(var i=0; i<intervals.length; ++i) {
    var s = intervals[i]
    if(s[1] < mid) {
      leftIntervals.push(s)
    } else if(mid < s[0]) {
      rightIntervals.push(s)
    } else {
      centerIntervals.push(s)
    }
  }

  //Split center intervals
  var leftPoints = centerIntervals
  var rightPoints = centerIntervals.slice()
  leftPoints.sort(compareBegin)
  rightPoints.sort(compareEnd)

  return new IntervalTreeNode(mid, 
    createIntervalTree(leftIntervals),
    createIntervalTree(rightIntervals),
    leftPoints,
    rightPoints)
}

//User friendly wrapper that makes it possible to support empty trees
function IntervalTree(root) {
  this.root = root
}

var tproto = IntervalTree.prototype

tproto.insert = function(interval) {
  if(this.root) {
    this.root.insert(interval)
  } else {
    this.root = new IntervalTreeNode(interval[0], null, null, [interval], [interval])
  }
}

tproto.remove = function(interval) {
  if(this.root) {
    var r = this.root.remove(interval)
    if(r === EMPTY) {
      this.root = null
    }
    return r !== NOT_FOUND
  }
  return false
}

tproto.queryPoint = function(p, cb) {
  if(this.root) {
    return this.root.queryPoint(p, cb)
  }
}

tproto.queryInterval = function(lo, hi, cb) {
  if(lo <= hi && this.root) {
    return this.root.queryInterval(lo, hi, cb)
  }
}

Object.defineProperty(tproto, "count", {
  get: function() {
    if(this.root) {
      return this.root.count
    }
    return 0
  }
})

Object.defineProperty(tproto, "intervals", {
  get: function() {
    if(this.root) {
      return this.root.intervals([])
    }
    return []
  }
})

function createWrapper(intervals) {
  if(!intervals || intervals.length === 0) {
    return new IntervalTree(null)
  }
  return new IntervalTree(createIntervalTree(intervals))
}

},{"binary-search-bounds":67}],69:[function(require,module,exports){
"use strict"

module.exports = orderSegments

var orient = require("robust-orientation")

function horizontalOrder(a, b) {
  var bl, br
  if(b[0][0] < b[1][0]) {
    bl = b[0]
    br = b[1]
  } else if(b[0][0] > b[1][0]) {
    bl = b[1]
    br = b[0]
  } else {
    var alo = Math.min(a[0][1], a[1][1])
    var ahi = Math.max(a[0][1], a[1][1])
    var blo = Math.min(b[0][1], b[1][1])
    var bhi = Math.max(b[0][1], b[1][1])
    if(ahi < blo) {
      return ahi - blo
    }
    if(alo > bhi) {
      return alo - bhi
    }
    return ahi - bhi
  }
  var al, ar
  if(a[0][1] < a[1][1]) {
    al = a[0]
    ar = a[1]
  } else {
    al = a[1]
    ar = a[0]
  }
  var d = orient(br, bl, al)
  if(d) {
    return d
  }
  d = orient(br, bl, ar)
  if(d) {
    return d
  }
  return ar - br
}

function orderSegments(b, a) {
  var al, ar
  if(a[0][0] < a[1][0]) {
    al = a[0]
    ar = a[1]
  } else if(a[0][0] > a[1][0]) {
    al = a[1]
    ar = a[0]
  } else {
    return horizontalOrder(a, b)
  }
  var bl, br
  if(b[0][0] < b[1][0]) {
    bl = b[0]
    br = b[1]
  } else if(b[0][0] > b[1][0]) {
    bl = b[1]
    br = b[0]
  } else {
    return -horizontalOrder(b, a)
  }
  var d1 = orient(al, ar, br)
  var d2 = orient(al, ar, bl)
  if(d1 < 0) {
    if(d2 <= 0) {
      return d1
    }
  } else if(d1 > 0) {
    if(d2 >= 0) {
      return d1
    }
  } else if(d2) {
    return d2
  }
  d1 = orient(br, bl, ar)
  d2 = orient(br, bl, al)
  if(d1 < 0) {
    if(d2 <= 0) {
      return d1
    }
  } else if(d1 > 0) {
    if(d2 >= 0) {
      return d1
    }
  } else if(d2) {
    return d2
  }
  return ar[0] - br[0]
}
},{"robust-orientation":51}],70:[function(require,module,exports){
"use strict"

module.exports = createRBTree

var RED   = 0
var BLACK = 1

function RBNode(color, key, value, left, right, count) {
  this._color = color
  this.key = key
  this.value = value
  this.left = left
  this.right = right
  this._count = count
}

function cloneNode(node) {
  return new RBNode(node._color, node.key, node.value, node.left, node.right, node._count)
}

function repaint(color, node) {
  return new RBNode(color, node.key, node.value, node.left, node.right, node._count)
}

function recount(node) {
  node._count = 1 + (node.left ? node.left._count : 0) + (node.right ? node.right._count : 0)
}

function RedBlackTree(compare, root) {
  this._compare = compare
  this.root = root
}

var proto = RedBlackTree.prototype

Object.defineProperty(proto, "keys", {
  get: function() {
    var result = []
    this.forEach(function(k,v) {
      result.push(k)
    })
    return result
  }
})

Object.defineProperty(proto, "values", {
  get: function() {
    var result = []
    this.forEach(function(k,v) {
      result.push(v)
    })
    return result
  }
})

//Returns the number of nodes in the tree
Object.defineProperty(proto, "length", {
  get: function() {
    if(this.root) {
      return this.root._count
    }
    return 0
  }
})

//Insert a new item into the tree
proto.insert = function(key, value) {
  var cmp = this._compare
  //Find point to insert new node at
  var n = this.root
  var n_stack = []
  var d_stack = []
  while(n) {
    var d = cmp(key, n.key)
    n_stack.push(n)
    d_stack.push(d)
    if(d <= 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  //Rebuild path to leaf node
  n_stack.push(new RBNode(RED, key, value, null, null, 1))
  for(var s=n_stack.length-2; s>=0; --s) {
    var n = n_stack[s]
    if(d_stack[s] <= 0) {
      n_stack[s] = new RBNode(n._color, n.key, n.value, n_stack[s+1], n.right, n._count+1)
    } else {
      n_stack[s] = new RBNode(n._color, n.key, n.value, n.left, n_stack[s+1], n._count+1)
    }
  }
  //Rebalance tree using rotations
  //console.log("start insert", key, d_stack)
  for(var s=n_stack.length-1; s>1; --s) {
    var p = n_stack[s-1]
    var n = n_stack[s]
    if(p._color === BLACK || n._color === BLACK) {
      break
    }
    var pp = n_stack[s-2]
    if(pp.left === p) {
      if(p.left === n) {
        var y = pp.right
        if(y && y._color === RED) {
          //console.log("LLr")
          p._color = BLACK
          pp.right = repaint(BLACK, y)
          pp._color = RED
          s -= 1
        } else {
          //console.log("LLb")
          pp._color = RED
          pp.left = p.right
          p._color = BLACK
          p.right = pp
          n_stack[s-2] = p
          n_stack[s-1] = n
          recount(pp)
          recount(p)
          if(s >= 3) {
            var ppp = n_stack[s-3]
            if(ppp.left === pp) {
              ppp.left = p
            } else {
              ppp.right = p
            }
          }
          break
        }
      } else {
        var y = pp.right
        if(y && y._color === RED) {
          //console.log("LRr")
          p._color = BLACK
          pp.right = repaint(BLACK, y)
          pp._color = RED
          s -= 1
        } else {
          //console.log("LRb")
          p.right = n.left
          pp._color = RED
          pp.left = n.right
          n._color = BLACK
          n.left = p
          n.right = pp
          n_stack[s-2] = n
          n_stack[s-1] = p
          recount(pp)
          recount(p)
          recount(n)
          if(s >= 3) {
            var ppp = n_stack[s-3]
            if(ppp.left === pp) {
              ppp.left = n
            } else {
              ppp.right = n
            }
          }
          break
        }
      }
    } else {
      if(p.right === n) {
        var y = pp.left
        if(y && y._color === RED) {
          //console.log("RRr", y.key)
          p._color = BLACK
          pp.left = repaint(BLACK, y)
          pp._color = RED
          s -= 1
        } else {
          //console.log("RRb")
          pp._color = RED
          pp.right = p.left
          p._color = BLACK
          p.left = pp
          n_stack[s-2] = p
          n_stack[s-1] = n
          recount(pp)
          recount(p)
          if(s >= 3) {
            var ppp = n_stack[s-3]
            if(ppp.right === pp) {
              ppp.right = p
            } else {
              ppp.left = p
            }
          }
          break
        }
      } else {
        var y = pp.left
        if(y && y._color === RED) {
          //console.log("RLr")
          p._color = BLACK
          pp.left = repaint(BLACK, y)
          pp._color = RED
          s -= 1
        } else {
          //console.log("RLb")
          p.left = n.right
          pp._color = RED
          pp.right = n.left
          n._color = BLACK
          n.right = p
          n.left = pp
          n_stack[s-2] = n
          n_stack[s-1] = p
          recount(pp)
          recount(p)
          recount(n)
          if(s >= 3) {
            var ppp = n_stack[s-3]
            if(ppp.right === pp) {
              ppp.right = n
            } else {
              ppp.left = n
            }
          }
          break
        }
      }
    }
  }
  //Return new tree
  n_stack[0]._color = BLACK
  return new RedBlackTree(cmp, n_stack[0])
}


//Visit all nodes inorder
function doVisitFull(visit, node) {
  if(node.left) {
    var v = doVisitFull(visit, node.left)
    if(v) { return v }
  }
  var v = visit(node.key, node.value)
  if(v) { return v }
  if(node.right) {
    return doVisitFull(visit, node.right)
  }
}

//Visit half nodes in order
function doVisitHalf(lo, compare, visit, node) {
  var l = compare(lo, node.key)
  if(l <= 0) {
    if(node.left) {
      var v = doVisitHalf(lo, compare, visit, node.left)
      if(v) { return v }
    }
    var v = visit(node.key, node.value)
    if(v) { return v }
  }
  if(node.right) {
    return doVisitHalf(lo, compare, visit, node.right)
  }
}

//Visit all nodes within a range
function doVisit(lo, hi, compare, visit, node) {
  var l = compare(lo, node.key)
  var h = compare(hi, node.key)
  var v
  if(l <= 0) {
    if(node.left) {
      v = doVisit(lo, hi, compare, visit, node.left)
      if(v) { return v }
    }
    if(h > 0) {
      v = visit(node.key, node.value)
      if(v) { return v }
    }
  }
  if(h > 0 && node.right) {
    return doVisit(lo, hi, compare, visit, node.right)
  }
}


proto.forEach = function rbTreeForEach(visit, lo, hi) {
  if(!this.root) {
    return
  }
  switch(arguments.length) {
    case 1:
      return doVisitFull(visit, this.root)
    break

    case 2:
      return doVisitHalf(lo, this._compare, visit, this.root)
    break

    case 3:
      if(this._compare(lo, hi) >= 0) {
        return
      }
      return doVisit(lo, hi, this._compare, visit, this.root)
    break
  }
}

//First item in list
Object.defineProperty(proto, "begin", {
  get: function() {
    var stack = []
    var n = this.root
    while(n) {
      stack.push(n)
      n = n.left
    }
    return new RedBlackTreeIterator(this, stack)
  }
})

//Last item in list
Object.defineProperty(proto, "end", {
  get: function() {
    var stack = []
    var n = this.root
    while(n) {
      stack.push(n)
      n = n.right
    }
    return new RedBlackTreeIterator(this, stack)
  }
})

//Find the ith item in the tree
proto.at = function(idx) {
  if(idx < 0) {
    return new RedBlackTreeIterator(this, [])
  }
  var n = this.root
  var stack = []
  while(true) {
    stack.push(n)
    if(n.left) {
      if(idx < n.left._count) {
        n = n.left
        continue
      }
      idx -= n.left._count
    }
    if(!idx) {
      return new RedBlackTreeIterator(this, stack)
    }
    idx -= 1
    if(n.right) {
      if(idx >= n.right._count) {
        break
      }
      n = n.right
    } else {
      break
    }
  }
  return new RedBlackTreeIterator(this, [])
}

proto.ge = function(key) {
  var cmp = this._compare
  var n = this.root
  var stack = []
  var last_ptr = 0
  while(n) {
    var d = cmp(key, n.key)
    stack.push(n)
    if(d <= 0) {
      last_ptr = stack.length
    }
    if(d <= 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  stack.length = last_ptr
  return new RedBlackTreeIterator(this, stack)
}

proto.gt = function(key) {
  var cmp = this._compare
  var n = this.root
  var stack = []
  var last_ptr = 0
  while(n) {
    var d = cmp(key, n.key)
    stack.push(n)
    if(d < 0) {
      last_ptr = stack.length
    }
    if(d < 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  stack.length = last_ptr
  return new RedBlackTreeIterator(this, stack)
}

proto.lt = function(key) {
  var cmp = this._compare
  var n = this.root
  var stack = []
  var last_ptr = 0
  while(n) {
    var d = cmp(key, n.key)
    stack.push(n)
    if(d > 0) {
      last_ptr = stack.length
    }
    if(d <= 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  stack.length = last_ptr
  return new RedBlackTreeIterator(this, stack)
}

proto.le = function(key) {
  var cmp = this._compare
  var n = this.root
  var stack = []
  var last_ptr = 0
  while(n) {
    var d = cmp(key, n.key)
    stack.push(n)
    if(d >= 0) {
      last_ptr = stack.length
    }
    if(d < 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  stack.length = last_ptr
  return new RedBlackTreeIterator(this, stack)
}

//Finds the item with key if it exists
proto.find = function(key) {
  var cmp = this._compare
  var n = this.root
  var stack = []
  while(n) {
    var d = cmp(key, n.key)
    stack.push(n)
    if(d === 0) {
      return new RedBlackTreeIterator(this, stack)
    }
    if(d <= 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  return new RedBlackTreeIterator(this, [])
}

//Removes item with key from tree
proto.remove = function(key) {
  var iter = this.find(key)
  if(iter) {
    return iter.remove()
  }
  return this
}

//Returns the item at `key`
proto.get = function(key) {
  var cmp = this._compare
  var n = this.root
  while(n) {
    var d = cmp(key, n.key)
    if(d === 0) {
      return n.value
    }
    if(d <= 0) {
      n = n.left
    } else {
      n = n.right
    }
  }
  return
}

//Iterator for red black tree
function RedBlackTreeIterator(tree, stack) {
  this.tree = tree
  this._stack = stack
}

var iproto = RedBlackTreeIterator.prototype

//Test if iterator is valid
Object.defineProperty(iproto, "valid", {
  get: function() {
    return this._stack.length > 0
  }
})

//Node of the iterator
Object.defineProperty(iproto, "node", {
  get: function() {
    if(this._stack.length > 0) {
      return this._stack[this._stack.length-1]
    }
    return null
  },
  enumerable: true
})

//Makes a copy of an iterator
iproto.clone = function() {
  return new RedBlackTreeIterator(this.tree, this._stack.slice())
}

//Swaps two nodes
function swapNode(n, v) {
  n.key = v.key
  n.value = v.value
  n.left = v.left
  n.right = v.right
  n._color = v._color
  n._count = v._count
}

//Fix up a double black node in a tree
function fixDoubleBlack(stack) {
  var n, p, s, z
  for(var i=stack.length-1; i>=0; --i) {
    n = stack[i]
    if(i === 0) {
      n._color = BLACK
      return
    }
    //console.log("visit node:", n.key, i, stack[i].key, stack[i-1].key)
    p = stack[i-1]
    if(p.left === n) {
      //console.log("left child")
      s = p.right
      if(s.right && s.right._color === RED) {
        //console.log("case 1: right sibling child red")
        s = p.right = cloneNode(s)
        z = s.right = cloneNode(s.right)
        p.right = s.left
        s.left = p
        s.right = z
        s._color = p._color
        n._color = BLACK
        p._color = BLACK
        z._color = BLACK
        recount(p)
        recount(s)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.left === p) {
            pp.left = s
          } else {
            pp.right = s
          }
        }
        stack[i-1] = s
        return
      } else if(s.left && s.left._color === RED) {
        //console.log("case 1: left sibling child red")
        s = p.right = cloneNode(s)
        z = s.left = cloneNode(s.left)
        p.right = z.left
        s.left = z.right
        z.left = p
        z.right = s
        z._color = p._color
        p._color = BLACK
        s._color = BLACK
        n._color = BLACK
        recount(p)
        recount(s)
        recount(z)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.left === p) {
            pp.left = z
          } else {
            pp.right = z
          }
        }
        stack[i-1] = z
        return
      }
      if(s._color === BLACK) {
        if(p._color === RED) {
          //console.log("case 2: black sibling, red parent", p.right.value)
          p._color = BLACK
          p.right = repaint(RED, s)
          return
        } else {
          //console.log("case 2: black sibling, black parent", p.right.value)
          p.right = repaint(RED, s)
          continue  
        }
      } else {
        //console.log("case 3: red sibling")
        s = cloneNode(s)
        p.right = s.left
        s.left = p
        s._color = p._color
        p._color = RED
        recount(p)
        recount(s)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.left === p) {
            pp.left = s
          } else {
            pp.right = s
          }
        }
        stack[i-1] = s
        stack[i] = p
        if(i+1 < stack.length) {
          stack[i+1] = n
        } else {
          stack.push(n)
        }
        i = i+2
      }
    } else {
      //console.log("right child")
      s = p.left
      if(s.left && s.left._color === RED) {
        //console.log("case 1: left sibling child red", p.value, p._color)
        s = p.left = cloneNode(s)
        z = s.left = cloneNode(s.left)
        p.left = s.right
        s.right = p
        s.left = z
        s._color = p._color
        n._color = BLACK
        p._color = BLACK
        z._color = BLACK
        recount(p)
        recount(s)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.right === p) {
            pp.right = s
          } else {
            pp.left = s
          }
        }
        stack[i-1] = s
        return
      } else if(s.right && s.right._color === RED) {
        //console.log("case 1: right sibling child red")
        s = p.left = cloneNode(s)
        z = s.right = cloneNode(s.right)
        p.left = z.right
        s.right = z.left
        z.right = p
        z.left = s
        z._color = p._color
        p._color = BLACK
        s._color = BLACK
        n._color = BLACK
        recount(p)
        recount(s)
        recount(z)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.right === p) {
            pp.right = z
          } else {
            pp.left = z
          }
        }
        stack[i-1] = z
        return
      }
      if(s._color === BLACK) {
        if(p._color === RED) {
          //console.log("case 2: black sibling, red parent")
          p._color = BLACK
          p.left = repaint(RED, s)
          return
        } else {
          //console.log("case 2: black sibling, black parent")
          p.left = repaint(RED, s)
          continue  
        }
      } else {
        //console.log("case 3: red sibling")
        s = cloneNode(s)
        p.left = s.right
        s.right = p
        s._color = p._color
        p._color = RED
        recount(p)
        recount(s)
        if(i > 1) {
          var pp = stack[i-2]
          if(pp.right === p) {
            pp.right = s
          } else {
            pp.left = s
          }
        }
        stack[i-1] = s
        stack[i] = p
        if(i+1 < stack.length) {
          stack[i+1] = n
        } else {
          stack.push(n)
        }
        i = i+2
      }
    }
  }
}

//Removes item at iterator from tree
iproto.remove = function() {
  var stack = this._stack
  if(stack.length === 0) {
    return this.tree
  }
  //First copy path to node
  var cstack = new Array(stack.length)
  var n = stack[stack.length-1]
  cstack[cstack.length-1] = new RBNode(n._color, n.key, n.value, n.left, n.right, n._count)
  for(var i=stack.length-2; i>=0; --i) {
    var n = stack[i]
    if(n.left === stack[i+1]) {
      cstack[i] = new RBNode(n._color, n.key, n.value, cstack[i+1], n.right, n._count)
    } else {
      cstack[i] = new RBNode(n._color, n.key, n.value, n.left, cstack[i+1], n._count)
    }
  }

  //Get node
  n = cstack[cstack.length-1]
  //console.log("start remove: ", n.value)

  //If not leaf, then swap with previous node
  if(n.left && n.right) {
    //console.log("moving to leaf")

    //First walk to previous leaf
    var split = cstack.length
    n = n.left
    while(n.right) {
      cstack.push(n)
      n = n.right
    }
    //Copy path to leaf
    var v = cstack[split-1]
    cstack.push(new RBNode(n._color, v.key, v.value, n.left, n.right, n._count))
    cstack[split-1].key = n.key
    cstack[split-1].value = n.value

    //Fix up stack
    for(var i=cstack.length-2; i>=split; --i) {
      n = cstack[i]
      cstack[i] = new RBNode(n._color, n.key, n.value, n.left, cstack[i+1], n._count)
    }
    cstack[split-1].left = cstack[split]
  }
  //console.log("stack=", cstack.map(function(v) { return v.value }))

  //Remove leaf node
  n = cstack[cstack.length-1]
  if(n._color === RED) {
    //Easy case: removing red leaf
    //console.log("RED leaf")
    var p = cstack[cstack.length-2]
    if(p.left === n) {
      p.left = null
    } else if(p.right === n) {
      p.right = null
    }
    cstack.pop()
    for(var i=0; i<cstack.length; ++i) {
      cstack[i]._count--
    }
    return new RedBlackTree(this.tree._compare, cstack[0])
  } else {
    if(n.left || n.right) {
      //Second easy case:  Single child black parent
      //console.log("BLACK single child")
      if(n.left) {
        swapNode(n, n.left)
      } else if(n.right) {
        swapNode(n, n.right)
      }
      //Child must be red, so repaint it black to balance color
      n._color = BLACK
      for(var i=0; i<cstack.length-1; ++i) {
        cstack[i]._count--
      }
      return new RedBlackTree(this.tree._compare, cstack[0])
    } else if(cstack.length === 1) {
      //Third easy case: root
      //console.log("ROOT")
      return new RedBlackTree(this.tree._compare, null)
    } else {
      //Hard case: Repaint n, and then do some nasty stuff
      //console.log("BLACK leaf no children")
      for(var i=0; i<cstack.length; ++i) {
        cstack[i]._count--
      }
      var parent = cstack[cstack.length-2]
      fixDoubleBlack(cstack)
      //Fix up links
      if(parent.left === n) {
        parent.left = null
      } else {
        parent.right = null
      }
    }
  }
  return new RedBlackTree(this.tree._compare, cstack[0])
}

//Returns key
Object.defineProperty(iproto, "key", {
  get: function() {
    if(this._stack.length > 0) {
      return this._stack[this._stack.length-1].key
    }
    return
  },
  enumerable: true
})

//Returns value
Object.defineProperty(iproto, "value", {
  get: function() {
    if(this._stack.length > 0) {
      return this._stack[this._stack.length-1].value
    }
    return
  },
  enumerable: true
})


//Returns the position of this iterator in the sorted list
Object.defineProperty(iproto, "index", {
  get: function() {
    var idx = 0
    var stack = this._stack
    if(stack.length === 0) {
      var r = this.tree.root
      if(r) {
        return r._count
      }
      return 0
    } else if(stack[stack.length-1].left) {
      idx = stack[stack.length-1].left._count
    }
    for(var s=stack.length-2; s>=0; --s) {
      if(stack[s+1] === stack[s].right) {
        ++idx
        if(stack[s].left) {
          idx += stack[s].left._count
        }
      }
    }
    return idx
  },
  enumerable: true
})

//Advances iterator to next element in list
iproto.next = function() {
  var stack = this._stack
  if(stack.length === 0) {
    return
  }
  var n = stack[stack.length-1]
  if(n.right) {
    n = n.right
    while(n) {
      stack.push(n)
      n = n.left
    }
  } else {
    stack.pop()
    while(stack.length > 0 && stack[stack.length-1].right === n) {
      n = stack[stack.length-1]
      stack.pop()
    }
  }
}

//Checks if iterator is at end of tree
Object.defineProperty(iproto, "hasNext", {
  get: function() {
    var stack = this._stack
    if(stack.length === 0) {
      return false
    }
    if(stack[stack.length-1].right) {
      return true
    }
    for(var s=stack.length-1; s>0; --s) {
      if(stack[s-1].left === stack[s]) {
        return true
      }
    }
    return false
  }
})

//Update value
iproto.update = function(value) {
  var stack = this._stack
  if(stack.length === 0) {
    throw new Error("Can't update empty node!")
  }
  var cstack = new Array(stack.length)
  var n = stack[stack.length-1]
  cstack[cstack.length-1] = new RBNode(n._color, n.key, value, n.left, n.right, n._count)
  for(var i=stack.length-2; i>=0; --i) {
    n = stack[i]
    if(n.left === stack[i+1]) {
      cstack[i] = new RBNode(n._color, n.key, n.value, cstack[i+1], n.right, n._count)
    } else {
      cstack[i] = new RBNode(n._color, n.key, n.value, n.left, cstack[i+1], n._count)
    }
  }
  return new RedBlackTree(this.tree._compare, cstack[0])
}

//Moves iterator backward one element
iproto.prev = function() {
  var stack = this._stack
  if(stack.length === 0) {
    return
  }
  var n = stack[stack.length-1]
  if(n.left) {
    n = n.left
    while(n) {
      stack.push(n)
      n = n.right
    }
  } else {
    stack.pop()
    while(stack.length > 0 && stack[stack.length-1].left === n) {
      n = stack[stack.length-1]
      stack.pop()
    }
  }
}

//Checks if iterator is at start of tree
Object.defineProperty(iproto, "hasPrev", {
  get: function() {
    var stack = this._stack
    if(stack.length === 0) {
      return false
    }
    if(stack[stack.length-1].left) {
      return true
    }
    for(var s=stack.length-1; s>0; --s) {
      if(stack[s-1].right === stack[s]) {
        return true
      }
    }
    return false
  }
})

//Default comparison function
function defaultCompare(a, b) {
  if(a < b) {
    return -1
  }
  if(a > b) {
    return 1
  }
  return 0
}

//Build a tree
function createRBTree(compare) {
  return new RedBlackTree(compare || defaultCompare, null)
}
},{}],71:[function(require,module,exports){
"use strict"

module.exports = createSlabDecomposition

var bounds = require("binary-search-bounds")
var createRBTree = require("functional-red-black-tree")
var orient = require("robust-orientation")
var orderSegments = require("./lib/order-segments")

function SlabDecomposition(slabs, coordinates, horizontal) {
  this.slabs = slabs
  this.coordinates = coordinates
  this.horizontal = horizontal
}

var proto = SlabDecomposition.prototype

function compareHorizontal(e, y) {
  return e.y - y
}

function searchBucket(root, p) {
  var lastNode = null
  while(root) {
    var seg = root.key
    var l, r
    if(seg[0][0] < seg[1][0]) {
      l = seg[0]
      r = seg[1]
    } else {
      l = seg[1]
      r = seg[0]
    }
    var o = orient(l, r, p)
    if(o < 0) {
      root = root.left
    } else if(o > 0) {
      if(p[0] !== seg[1][0]) {
        lastNode = root
        root = root.right
      } else {
        var val = searchBucket(root.right, p)
        if(val) {
          return val
        }
        root = root.left
      }
    } else {
      if(p[0] !== seg[1][0]) {
        return root
      } else {
        var val = searchBucket(root.right, p)
        if(val) {
          return val
        }
        root = root.left
      }
    }
  }
  return lastNode
}

proto.castUp = function(p) {
  var bucket = bounds.le(this.coordinates, p[0])
  if(bucket < 0) {
    return -1
  }
  var root = this.slabs[bucket]
  var hitNode = searchBucket(this.slabs[bucket], p)
  var lastHit = -1
  if(hitNode) {
    lastHit = hitNode.value
  }
  //Edge case: need to handle horizontal segments (sucks)
  if(this.coordinates[bucket] === p[0]) {
    var lastSegment = null
    if(hitNode) {
      lastSegment = hitNode.key
    }
    if(bucket > 0) {
      var otherHitNode = searchBucket(this.slabs[bucket-1], p)
      if(otherHitNode) {
        if(lastSegment) {
          if(orderSegments(otherHitNode.key, lastSegment) > 0) {
            lastSegment = otherHitNode.key
            lastHit = otherHitNode.value
          }
        } else {
          lastHit = otherHitNode.value
          lastSegment = otherHitNode.key
        }
      }
    }
    var horiz = this.horizontal[bucket]
    if(horiz.length > 0) {
      var hbucket = bounds.ge(horiz, p[1], compareHorizontal)
      if(hbucket < horiz.length) {
        var e = horiz[hbucket]
        if(p[1] === e.y) {
          if(e.closed) {
            return e.index
          } else {
            while(hbucket < horiz.length-1 && horiz[hbucket+1].y === p[1]) {
              hbucket = hbucket+1
              e = horiz[hbucket]
              if(e.closed) {
                return e.index
              }
            }
            if(e.y === p[1] && !e.start) {
              hbucket = hbucket+1
              if(hbucket >= horiz.length) {
                return lastHit
              }
              e = horiz[hbucket]
            }
          }
        }
        //Check if e is above/below last segment
        if(e.start) {
          if(lastSegment) {
            var o = orient(lastSegment[0], lastSegment[1], [p[0], e.y])
            if(lastSegment[0][0] > lastSegment[1][0]) {
              o = -o
            }
            if(o > 0) {
              lastHit = e.index
            }
          } else {
            lastHit = e.index
          }
        } else if(e.y !== p[1]) {
          lastHit = e.index
        }
      }
    }
  }
  return lastHit
}

function IntervalSegment(y, index, start, closed) {
  this.y = y
  this.index = index
  this.start = start
  this.closed = closed
}

function Event(x, segment, create, index) {
  this.x = x
  this.segment = segment
  this.create = create
  this.index = index
}


function createSlabDecomposition(segments) {
  var numSegments = segments.length
  var numEvents = 2 * numSegments
  var events = new Array(numEvents)
  for(var i=0; i<numSegments; ++i) {
    var s = segments[i]
    var f = s[0][0] < s[1][0]
    events[2*i] = new Event(s[0][0], s, f, i)
    events[2*i+1] = new Event(s[1][0], s, !f, i)
  }
  events.sort(function(a,b) {
    var d = a.x - b.x
    if(d) {
      return d
    }
    d = a.create - b.create
    if(d) {
      return d
    }
    return Math.min(a.segment[0][1], a.segment[1][1]) - Math.min(b.segment[0][1], b.segment[1][1])
  })
  var tree = createRBTree(orderSegments)
  var slabs = []
  var lines = []
  var horizontal = []
  var lastX = -Infinity
  for(var i=0; i<numEvents; ) {
    var x = events[i].x
    var horiz = []
    while(i < numEvents) {
      var e = events[i]
      if(e.x !== x) {
        break
      }
      i += 1
      if(e.segment[0][0] === e.x && e.segment[1][0] === e.x) {
        if(e.create) {
          if(e.segment[0][1] < e.segment[1][1]) {
            horiz.push(new IntervalSegment(
                e.segment[0][1],
                e.index,
                true,
                true))
            horiz.push(new IntervalSegment(
                e.segment[1][1],
                e.index,
                false,
                false))
          } else {
            horiz.push(new IntervalSegment(
                e.segment[1][1],
                e.index,
                true,
                false))
            horiz.push(new IntervalSegment(
                e.segment[0][1],
                e.index,
                false,
                true))
          }
        }
      } else {
        if(e.create) {
          tree = tree.insert(e.segment, e.index)
        } else {
          tree = tree.remove(e.segment)
        }
      }
    }
    slabs.push(tree.root)
    lines.push(x)
    horizontal.push(horiz)
  }
  return new SlabDecomposition(slabs, lines, horizontal)
}
},{"./lib/order-segments":69,"binary-search-bounds":67,"functional-red-black-tree":70,"robust-orientation":51}],72:[function(require,module,exports){
module.exports = preprocessPolygon

var orient = require('robust-orientation')[3]
var makeSlabs = require('slab-decomposition')
var makeIntervalTree = require('interval-tree-1d')
var bsearch = require('binary-search-bounds')

function visitInterval() {
  return true
}

function intervalSearch(table) {
  return function(x, y) {
    var tree = table[x]
    if(tree) {
      return !!tree.queryPoint(y, visitInterval)
    }
    return false
  }
}

function buildVerticalIndex(segments) {
  var table = {}
  for(var i=0; i<segments.length; ++i) {
    var s = segments[i]
    var x = s[0][0]
    var y0 = s[0][1]
    var y1 = s[1][1]
    var p = [ Math.min(y0, y1), Math.max(y0, y1) ]
    if(x in table) {
      table[x].push(p)
    } else {
      table[x] = [ p ]
    }
  }
  var intervalTable = {}
  var keys = Object.keys(table)
  for(var i=0; i<keys.length; ++i) {
    var segs = table[keys[i]]
    intervalTable[keys[i]] = makeIntervalTree(segs)
  }
  return intervalSearch(intervalTable)
}

function buildSlabSearch(slabs, coordinates) {
  return function(p) {
    var bucket = bsearch.le(coordinates, p[0])
    if(bucket < 0) {
      return 1
    }
    var root = slabs[bucket]
    if(!root) {
      if(bucket > 0 && coordinates[bucket] === p[0]) {
        root = slabs[bucket-1]
      } else {
        return 1
      }
    }
    var lastOrientation = 1
    while(root) {
      var s = root.key
      var o = orient(p, s[0], s[1])
      if(s[0][0] < s[1][0]) {
        if(o < 0) {
          root = root.left
        } else if(o > 0) {
          lastOrientation = -1
          root = root.right
        } else {
          return 0
        }
      } else {
        if(o > 0) {
          root = root.left
        } else if(o < 0) {
          lastOrientation = 1
          root = root.right
        } else {
          return 0
        }
      }
    }
    return lastOrientation
  }
}

function classifyEmpty(p) {
  return 1
}

function createClassifyVertical(testVertical) {
  return function classify(p) {
    if(testVertical(p[0], p[1])) {
      return 0
    }
    return 1
  }
}

function createClassifyPointDegen(testVertical, testNormal) {
  return function classify(p) {
    if(testVertical(p[0], p[1])) {
      return 0
    }
    return testNormal(p)
  }
}

function preprocessPolygon(loops) {
  //Compute number of loops
  var numLoops = loops.length

  //Unpack segments
  var segments = []
  var vsegments = []
  var ptr = 0
  for(var i=0; i<numLoops; ++i) {
    var loop = loops[i]
    var numVertices = loop.length
    for(var s=numVertices-1,t=0; t<numVertices; s=(t++)) {
      var a = loop[s]
      var b = loop[t]
      if(a[0] === b[0]) {
        vsegments.push([a,b])
      } else {
        segments.push([a,b])
      }
    }
  }

  //Degenerate case: All loops are empty
  if(segments.length === 0) {
    if(vsegments.length === 0) {
      return classifyEmpty
    } else {
      return createClassifyVertical(buildVerticalIndex(vsegments))
    }
  }

  //Build slab decomposition
  var slabs = makeSlabs(segments)
  var testSlab = buildSlabSearch(slabs.slabs, slabs.coordinates)

  if(vsegments.length === 0) {
    return testSlab
  } else {
    return createClassifyPointDegen(
      buildVerticalIndex(vsegments),
      testSlab)
  }
}
},{"binary-search-bounds":67,"interval-tree-1d":68,"robust-orientation":51,"slab-decomposition":71}],73:[function(require,module,exports){
arguments[4][49][0].apply(exports,arguments)
},{"dup":49}],74:[function(require,module,exports){
arguments[4][50][0].apply(exports,arguments)
},{"dup":50}],75:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],76:[function(require,module,exports){
'use strict'

module.exports = planarGraphToPolyline

var e2a = require('edges-to-adjacency-list')
var planarDual = require('planar-dual')
var preprocessPolygon = require('point-in-big-polygon')
var twoProduct = require('two-product')
var robustSum = require('robust-sum')
var uniq = require('uniq')
var trimLeaves = require('./lib/trim-leaves')

function makeArray(length, fill) {
  var result = new Array(length)
  for(var i=0; i<length; ++i) {
    result[i] = fill
  }
  return result
}

function makeArrayOfArrays(length) {
  var result = new Array(length)
  for(var i=0; i<length; ++i) {
    result[i] = []
  }
  return result
}


function planarGraphToPolyline(edges, positions) {

  //Trim leaves
  var result = trimLeaves(edges, positions)
  edges = result[0]
  positions = result[1]

  var numVertices = positions.length
  var numEdges = edges.length

  //Calculate adjacency list, check manifold
  var adj = e2a(edges, positions.length)
  for(var i=0; i<numVertices; ++i) {
    if(adj[i].length % 2 === 1) {
      throw new Error('planar-graph-to-polyline: graph must be manifold')
    }
  }

  //Get faces
  var faces = planarDual(edges, positions)

  //Check orientation of a polygon using exact arithmetic
  function ccw(c) {
    var n = c.length
    var area = [0]
    for(var j=0; j<n; ++j) {
      var a = positions[c[j]]
      var b = positions[c[(j+1)%n]]
      var t00 = twoProduct(-a[0], a[1])
      var t01 = twoProduct(-a[0], b[1])
      var t10 = twoProduct( b[0], a[1])
      var t11 = twoProduct( b[0], b[1])
      area = robustSum(area, robustSum(robustSum(t00, t01), robustSum(t10, t11)))
    }
    return area[area.length-1] > 0
  }

  //Extract all clockwise faces
  faces = faces.filter(ccw)

  //Detect which loops are contained in one another to handle parent-of relation
  var numFaces = faces.length
  var parent = new Array(numFaces)
  var containment = new Array(numFaces)
  for(var i=0; i<numFaces; ++i) {
    parent[i] = i
    var row = new Array(numFaces)
    var loopVertices = faces[i].map(function(v) {
      return positions[v]
    })
    var pmc = preprocessPolygon([loopVertices])
    var count = 0
    outer:
    for(var j=0; j<numFaces; ++j) {
      row[j] = 0
      if(i === j) {
        continue
      }
      var c = faces[j]
      var n = c.length
      for(var k=0; k<n; ++k) {
        var d = pmc(positions[c[k]])
        if(d !== 0) {
          if(d < 0) {
            row[j] = 1
            count += 1
          }
          continue outer
        }
      }
      row[j] = 1
      count += 1
    }
    containment[i] = [count, i, row]
  }
  containment.sort(function(a,b) {
    return b[0] - a[0]
  })
  for(var i=0; i<numFaces; ++i) {
    var row = containment[i]
    var idx = row[1]
    var children = row[2]
    for(var j=0; j<numFaces; ++j) {
      if(children[j]) {
        parent[j] = idx
      }
    }
  }

  //Initialize face adjacency list
  var fadj = makeArrayOfArrays(numFaces)
  for(var i=0; i<numFaces; ++i) {
    fadj[i].push(parent[i])
    fadj[parent[i]].push(i)
  }

  //Build adjacency matrix for edges
  var edgeAdjacency = {}
  var internalVertices = makeArray(numVertices, false)
  for(var i=0; i<numFaces; ++i) {
    var c = faces[i]
    var n = c.length
    for(var j=0; j<n; ++j) {
      var a = c[j]
      var b = c[(j+1)%n]
      var key = Math.min(a,b) + ":" + Math.max(a,b)
      if(key in edgeAdjacency) {
        var neighbor = edgeAdjacency[key]
        fadj[neighbor].push(i)
        fadj[i].push(neighbor)
        internalVertices[a] = internalVertices[b] = true
      } else {
        edgeAdjacency[key] = i
      }
    }
  }

  function sharedBoundary(c) {
    var n = c.length
    for(var i=0; i<n; ++i) {
      if(!internalVertices[c[i]]) {
        return false
      }
    }
    return true
  }

  var toVisit = []
  var parity = makeArray(numFaces, -1)
  for(var i=0; i<numFaces; ++i) {
    if(parent[i] === i && !sharedBoundary(faces[i])) {
      toVisit.push(i)
      parity[i] = 0
    } else {
      parity[i] = -1
    }
  }

  //Using face adjacency, classify faces as in/out
  var result = []
  while(toVisit.length > 0) {
    var top = toVisit.pop()
    var nbhd = fadj[top]
    uniq(nbhd, function(a,b) {
      return a-b
    })
    var nnbhr = nbhd.length
    var p = parity[top]
    var polyline
    if(p === 0) {
      var c = faces[top]
      polyline = [c]
    }
    for(var i=0; i<nnbhr; ++i) {
      var f = nbhd[i]
      if(parity[f] >= 0) {
        continue
      }
      parity[f] = p^1
      toVisit.push(f)
      if(p === 0) {
        var c = faces[f]
        if(!sharedBoundary(c)) {
          c.reverse()
          polyline.push(c)
        }
      }
    }
    if(p === 0) {
      result.push(polyline)
    }
  }

  return result
}
},{"./lib/trim-leaves":59,"edges-to-adjacency-list":60,"planar-dual":61,"point-in-big-polygon":72,"robust-sum":73,"two-product":74,"uniq":75}],77:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],78:[function(require,module,exports){
"use strict"; "use restrict";

module.exports = UnionFind;

function UnionFind(count) {
  this.roots = new Array(count);
  this.ranks = new Array(count);
  
  for(var i=0; i<count; ++i) {
    this.roots[i] = i;
    this.ranks[i] = 0;
  }
}

UnionFind.prototype.length = function() {
  return this.roots.length;
}

UnionFind.prototype.makeSet = function() {
  var n = this.roots.length;
  this.roots.push(n);
  this.ranks.push(0);
  return n;
}

UnionFind.prototype.find = function(x) {
  var roots = this.roots;
  while(roots[x] !== x) {
    var y = roots[x];
    roots[x] = roots[y];
    x = y;
  }
  return x;
}

UnionFind.prototype.link = function(x, y) {
  var xr = this.find(x)
    , yr = this.find(y);
  if(xr === yr) {
    return;
  }
  var ranks = this.ranks
    , roots = this.roots
    , xd    = ranks[xr]
    , yd    = ranks[yr];
  if(xd < yd) {
    roots[xr] = yr;
  } else if(yd < xd) {
    roots[yr] = xr;
  } else {
    roots[yr] = xr;
    ++ranks[xr];
  }
}


},{}],79:[function(require,module,exports){
"use strict"; "use restrict";

var bits      = require("bit-twiddle")
  , UnionFind = require("union-find")

//Returns the dimension of a cell complex
function dimension(cells) {
  var d = 0
    , max = Math.max
  for(var i=0, il=cells.length; i<il; ++i) {
    d = max(d, cells[i].length)
  }
  return d-1
}
exports.dimension = dimension

//Counts the number of vertices in faces
function countVertices(cells) {
  var vc = -1
    , max = Math.max
  for(var i=0, il=cells.length; i<il; ++i) {
    var c = cells[i]
    for(var j=0, jl=c.length; j<jl; ++j) {
      vc = max(vc, c[j])
    }
  }
  return vc+1
}
exports.countVertices = countVertices

//Returns a deep copy of cells
function cloneCells(cells) {
  var ncells = new Array(cells.length)
  for(var i=0, il=cells.length; i<il; ++i) {
    ncells[i] = cells[i].slice(0)
  }
  return ncells
}
exports.cloneCells = cloneCells

//Ranks a pair of cells up to permutation
function compareCells(a, b) {
  var n = a.length
    , t = a.length - b.length
    , min = Math.min
  if(t) {
    return t
  }
  switch(n) {
    case 0:
      return 0;
    case 1:
      return a[0] - b[0];
    case 2:
      var d = a[0]+a[1]-b[0]-b[1]
      if(d) {
        return d
      }
      return min(a[0],a[1]) - min(b[0],b[1])
    case 3:
      var l1 = a[0]+a[1]
        , m1 = b[0]+b[1]
      d = l1+a[2] - (m1+b[2])
      if(d) {
        return d
      }
      var l0 = min(a[0], a[1])
        , m0 = min(b[0], b[1])
        , d  = min(l0, a[2]) - min(m0, b[2])
      if(d) {
        return d
      }
      return min(l0+a[2], l1) - min(m0+b[2], m1)
    
    //TODO: Maybe optimize n=4 as well?
    
    default:
      var as = a.slice(0)
      as.sort()
      var bs = b.slice(0)
      bs.sort()
      for(var i=0; i<n; ++i) {
        t = as[i] - bs[i]
        if(t) {
          return t
        }
      }
      return 0
  }
}
exports.compareCells = compareCells

function compareZipped(a, b) {
  return compareCells(a[0], b[0])
}

//Puts a cell complex into normal order for the purposes of findCell queries
function normalize(cells, attr) {
  if(attr) {
    var len = cells.length
    var zipped = new Array(len)
    for(var i=0; i<len; ++i) {
      zipped[i] = [cells[i], attr[i]]
    }
    zipped.sort(compareZipped)
    for(var i=0; i<len; ++i) {
      cells[i] = zipped[i][0]
      attr[i] = zipped[i][1]
    }
    return cells
  } else {
    cells.sort(compareCells)
    return cells
  }
}
exports.normalize = normalize

//Removes all duplicate cells in the complex
function unique(cells) {
  if(cells.length === 0) {
    return []
  }
  var ptr = 1
    , len = cells.length
  for(var i=1; i<len; ++i) {
    var a = cells[i]
    if(compareCells(a, cells[i-1])) {
      if(i === ptr) {
        ptr++
        continue
      }
      cells[ptr++] = a
    }
  }
  cells.length = ptr
  return cells
}
exports.unique = unique;

//Finds a cell in a normalized cell complex
function findCell(cells, c) {
  var lo = 0
    , hi = cells.length-1
    , r  = -1
  while (lo <= hi) {
    var mid = (lo + hi) >> 1
      , s   = compareCells(cells[mid], c)
    if(s <= 0) {
      if(s === 0) {
        r = mid
      }
      lo = mid + 1
    } else if(s > 0) {
      hi = mid - 1
    }
  }
  return r
}
exports.findCell = findCell;

//Builds an index for an n-cell.  This is more general than dual, but less efficient
function incidence(from_cells, to_cells) {
  var index = new Array(from_cells.length)
  for(var i=0, il=index.length; i<il; ++i) {
    index[i] = []
  }
  var b = []
  for(var i=0, n=to_cells.length; i<n; ++i) {
    var c = to_cells[i]
    var cl = c.length
    for(var k=1, kn=(1<<cl); k<kn; ++k) {
      b.length = bits.popCount(k)
      var l = 0
      for(var j=0; j<cl; ++j) {
        if(k & (1<<j)) {
          b[l++] = c[j]
        }
      }
      var idx=findCell(from_cells, b)
      if(idx < 0) {
        continue
      }
      while(true) {
        index[idx++].push(i)
        if(idx >= from_cells.length || compareCells(from_cells[idx], b) !== 0) {
          break
        }
      }
    }
  }
  return index
}
exports.incidence = incidence

//Computes the dual of the mesh.  This is basically an optimized version of buildIndex for the situation where from_cells is just the list of vertices
function dual(cells, vertex_count) {
  if(!vertex_count) {
    return incidence(unique(skeleton(cells, 0)), cells, 0)
  }
  var res = new Array(vertex_count)
  for(var i=0; i<vertex_count; ++i) {
    res[i] = []
  }
  for(var i=0, len=cells.length; i<len; ++i) {
    var c = cells[i]
    for(var j=0, cl=c.length; j<cl; ++j) {
      res[c[j]].push(i)
    }
  }
  return res
}
exports.dual = dual

//Enumerates all cells in the complex
function explode(cells) {
  var result = []
  for(var i=0, il=cells.length; i<il; ++i) {
    var c = cells[i]
      , cl = c.length|0
    for(var j=1, jl=(1<<cl); j<jl; ++j) {
      var b = []
      for(var k=0; k<cl; ++k) {
        if((j >>> k) & 1) {
          b.push(c[k])
        }
      }
      result.push(b)
    }
  }
  return normalize(result)
}
exports.explode = explode

//Enumerates all of the n-cells of a cell complex
function skeleton(cells, n) {
  if(n < 0) {
    return []
  }
  var result = []
    , k0     = (1<<(n+1))-1
  for(var i=0; i<cells.length; ++i) {
    var c = cells[i]
    for(var k=k0; k<(1<<c.length); k=bits.nextCombination(k)) {
      var b = new Array(n+1)
        , l = 0
      for(var j=0; j<c.length; ++j) {
        if(k & (1<<j)) {
          b[l++] = c[j]
        }
      }
      result.push(b)
    }
  }
  return normalize(result)
}
exports.skeleton = skeleton;

//Computes the boundary of all cells, does not remove duplicates
function boundary(cells) {
  var res = []
  for(var i=0,il=cells.length; i<il; ++i) {
    var c = cells[i]
    for(var j=0,cl=c.length; j<cl; ++j) {
      var b = new Array(c.length-1)
      for(var k=0, l=0; k<cl; ++k) {
        if(k !== j) {
          b[l++] = c[k]
        }
      }
      res.push(b)
    }
  }
  return normalize(res)
}
exports.boundary = boundary;

//Computes connected components for a dense cell complex
function connectedComponents_dense(cells, vertex_count) {
  var labels = new UnionFind(vertex_count)
  for(var i=0; i<cells.length; ++i) {
    var c = cells[i]
    for(var j=0; j<c.length; ++j) {
      for(var k=j+1; k<c.length; ++k) {
        labels.link(c[j], c[k])
      }
    }
  }
  var components = []
    , component_labels = labels.ranks
  for(var i=0; i<component_labels.length; ++i) {
    component_labels[i] = -1
  }
  for(var i=0; i<cells.length; ++i) {
    var l = labels.find(cells[i][0])
    if(component_labels[l] < 0) {
      component_labels[l] = components.length
      components.push([cells[i].slice(0)])
    } else {
      components[component_labels[l]].push(cells[i].slice(0))
    }
  }
  return components
}

//Computes connected components for a sparse graph
function connectedComponents_sparse(cells) {
  var vertices  = unique(normalize(skeleton(cells, 0)))
    , labels    = new UnionFind(vertices.length)
  for(var i=0; i<cells.length; ++i) {
    var c = cells[i]
    for(var j=0; j<c.length; ++j) {
      var vj = findCell(vertices, [c[j]])
      for(var k=j+1; k<c.length; ++k) {
        labels.link(vj, findCell(vertices, [c[k]]))
      }
    }
  }
  var components        = []
    , component_labels  = labels.ranks
  for(var i=0; i<component_labels.length; ++i) {
    component_labels[i] = -1
  }
  for(var i=0; i<cells.length; ++i) {
    var l = labels.find(findCell(vertices, [cells[i][0]]));
    if(component_labels[l] < 0) {
      component_labels[l] = components.length
      components.push([cells[i].slice(0)])
    } else {
      components[component_labels[l]].push(cells[i].slice(0))
    }
  }
  return components
}

//Computes connected components for a cell complex
function connectedComponents(cells, vertex_count) {
  if(vertex_count) {
    return connectedComponents_dense(cells, vertex_count)
  }
  return connectedComponents_sparse(cells)
}
exports.connectedComponents = connectedComponents

},{"bit-twiddle":77,"union-find":78}],80:[function(require,module,exports){
"use strict"

module.exports = simplifyPolygon

var orient = require("robust-orientation")
var sc = require("simplicial-complex")

function errorWeight(base, a, b) {
  var area = Math.abs(orient(base, a, b))
  var perim = Math.sqrt(Math.pow(a[0] - b[0], 2) + Math.pow(a[1]-b[1], 2))
  return area / perim
}

function simplifyPolygon(cells, positions, minArea) {

  var n = positions.length
  var nc = cells.length
  var inv = new Array(n)
  var outv = new Array(n)
  var weights = new Array(n)
  var dead = new Array(n)
  
  //Initialize tables
  for(var i=0; i<n; ++i) {
    inv[i] = outv[i] = -1
    weights[i] = Infinity
    dead[i] = false
  }

  //Compute neighbors
  for(var i=0; i<nc; ++i) {
    var c = cells[i]
    if(c.length !== 2) {
      throw new Error("Input must be a graph")
    }
    var s = c[1]
    var t = c[0]
    if(outv[t] !== -1) {
      outv[t] = -2
    } else {
      outv[t] = s
    }
    if(inv[s] !== -1) {
      inv[s] = -2
    } else {
      inv[s] = t
    }
  }

  //Updates the weight for vertex i
  function computeWeight(i) {
    if(dead[i]) {
      return Infinity
    }
    //TODO: Check that the line segment doesn't cross once simplified
    var s = inv[i]
    var t = outv[i]
    if((s<0) || (t<0)) {
      return Infinity
    } else {
      return errorWeight(positions[i], positions[s], positions[t])
    }
  }

  //Swaps two nodes on the heap (i,j) are the index of the nodes
  function heapSwap(i,j) {
    var a = heap[i]
    var b = heap[j]
    heap[i] = b
    heap[j] = a
    index[a] = j
    index[b] = i
  }

  //Returns the weight of node i on the heap
  function heapWeight(i) {
    return weights[heap[i]]
  }

  function heapParent(i) {
    if(i & 1) {
      return (i - 1) >> 1
    }
    return (i >> 1) - 1
  }

  //Bubble element i down the heap
  function heapDown(i) {
    var w = heapWeight(i)
    while(true) {
      var tw = w
      var left  = 2*i + 1
      var right = 2*(i + 1)
      var next = i
      if(left < heapCount) {
        var lw = heapWeight(left)
        if(lw < tw) {
          next = left
          tw = lw
        }
      }
      if(right < heapCount) {
        var rw = heapWeight(right)
        if(rw < tw) {
          next = right
        }
      }
      if(next === i) {
        return i
      }
      heapSwap(i, next)
      i = next      
    }
  }

  //Bubbles element i up the heap
  function heapUp(i) {
    var w = heapWeight(i)
    while(i > 0) {
      var parent = heapParent(i)
      if(parent >= 0) {
        var pw = heapWeight(parent)
        if(w < pw) {
          heapSwap(i, parent)
          i = parent
          continue
        }
      }
      return i
    }
  }

  //Pop minimum element
  function heapPop() {
    if(heapCount > 0) {
      var head = heap[0]
      heapSwap(0, heapCount-1)
      heapCount -= 1
      heapDown(0)
      return head
    }
    return -1
  }

  //Update heap item i
  function heapUpdate(i, w) {
    var a = heap[i]
    if(weights[a] === w) {
      return i
    }
    weights[a] = -Infinity
    heapUp(i)
    heapPop()
    weights[a] = w
    heapCount += 1
    return heapUp(heapCount-1)
  }

  //Kills a vertex (assume vertex already removed from heap)
  function kill(i) {
    if(dead[i]) {
      return
    }
    //Kill vertex
    dead[i] = true
    //Fixup topology
    var s = inv[i]
    var t = outv[i]
    if(inv[t] >= 0) {
      inv[t] = s
    }
    if(outv[s] >= 0) {
      outv[s] = t
    }

    //Update weights on s and t
    if(index[s] >= 0) {
      heapUpdate(index[s], computeWeight(s))
    }
    if(index[t] >= 0) {
      heapUpdate(index[t], computeWeight(t))
    }
  }

  //Initialize weights and heap
  var heap = []
  var index = new Array(n)
  for(var i=0; i<n; ++i) {
    var w = weights[i] = computeWeight(i)
    if(w < Infinity) {
      index[i] = heap.length
      heap.push(i)
    } else {
      index[i] = -1
    }
  }
  var heapCount = heap.length
  for(var i=heapCount>>1; i>=0; --i) {
    heapDown(i)
  }
  
  //Kill vertices
  while(true) {
    var hmin = heapPop()
    if((hmin < 0) || (weights[hmin] > minArea)) {
      break
    }
    kill(hmin)
  }

  //Build collapsed vertex table
  var npositions = []
  for(var i=0; i<n; ++i) {
    if(!dead[i]) {
      index[i] = npositions.length
      npositions.push(positions[i].slice())
    }
  }
  var nv = npositions.length

  function tortoiseHare(seq, start) {
    if(seq[start] < 0) {
      return start
    }
    var t = start
    var h = start
    do {
      //Walk two steps with h
      var nh = seq[h]
      if(!dead[h] || nh < 0 || nh === h) {
        break
      }
      h = nh
      nh = seq[h]
      if(!dead[h] || nh < 0 || nh === h) {
        break
      }
      h = nh

      //Walk one step with t
      t = seq[t]
    } while(t !== h)
    //Compress cycles
    for(var v=start; v!==h; v = seq[v]) {
      seq[v] = h
    }
    return h
  }

  var ncells = []
  cells.forEach(function(c) {
    var tin = tortoiseHare(inv, c[0])
    var tout = tortoiseHare(outv, c[1])
    if(tin >= 0 && tout >= 0 && tin !== tout) {
      var cin = index[tin]
      var cout = index[tout]
      if(cin !== cout) {
        ncells.push([ cin, cout ])
      }
    }
  })

  //Normalize result
  sc.unique(sc.normalize(ncells))

  //Return final list of cells
  return {
    positions: npositions,
    edges: ncells
  }
}
},{"robust-orientation":51,"simplicial-complex":79}],81:[function(require,module,exports){
"use strict"

var pool = require("typedarray-pool")

module.exports = createSurfaceExtractor

//Helper macros
function array(i) {
  return "a" + i
}
function data(i) {
  return "d" + i
}
function cube(i,bitmask) {
  return "c" + i + "_" + bitmask
}
function shape(i) {
  return "s" + i
}
function stride(i,j) {
  return "t" + i + "_" + j
}
function offset(i) {
  return "o" + i
}
function scalar(i) {
  return "x" + i
}
function pointer(i) {
  return "p" + i
}
function delta(i,bitmask) {
  return "d" + i + "_" + bitmask
}
function index(i) {
  return "i" + i
}
function step(i,j) {
  return "u" + i + "_" + j
}
function pcube(bitmask) {
  return "b" + bitmask
}
function qcube(bitmask) {
  return "y" + bitmask
}
function pdelta(bitmask) {
  return "e" + bitmask
}
function vert(i) {
  return "v" + i
}
var VERTEX_IDS = "V"
var PHASES = "P"
var VERTEX_COUNT = "N"
var POOL_SIZE = "Q"
var POINTER = "X"
var TEMPORARY = "T"

function permBitmask(dimension, mask, order) {
  var r = 0
  for(var i=0; i<dimension; ++i) {
    if(mask & (1<<i)) {
      r |= (1<<order[i])
    }
  }
  return r
}

//Generates the surface procedure
function compileSurfaceProcedure(vertexFunc, faceFunc, phaseFunc, scalarArgs, order, typesig) {
  var arrayArgs = typesig.length
  var dimension = order.length

  if(dimension < 2) {
    throw new Error("ndarray-extract-contour: Dimension must be at least 2")
  }

  var funcName = "extractContour" + order.join("_")
  var code = []
  var vars = []
  var args = []

  //Assemble arguments
  for(var i=0; i<arrayArgs; ++i) {
    args.push(array(i))  
  }
  for(var i=0; i<scalarArgs; ++i) {
    args.push(scalar(i))
  }

  //Shape
  for(var i=0; i<dimension; ++i) {
    vars.push(shape(i) + "=" + array(0) + ".shape[" + i + "]|0")
  }
  //Data, stride, offset pointers
  for(var i=0; i<arrayArgs; ++i) {
    vars.push(data(i) + "=" + array(i) + ".data",
              offset(i) + "=" + array(i) + ".offset|0")
    for(var j=0; j<dimension; ++j) {
      vars.push(stride(i,j) + "=" + array(i) + ".stride[" + j + "]|0")
    }
  }
  //Pointer, delta and cube variables
  for(var i=0; i<arrayArgs; ++i) {
    vars.push(pointer(i) + "=" + offset(i))
    vars.push(cube(i,0))
    for(var j=1; j<(1<<dimension); ++j) {
      var ptrStr = []
      for(var k=0; k<dimension; ++k) {
        if(j & (1<<k)) {
          ptrStr.push("-" + stride(i,k))
        }
      }
      vars.push(delta(i,j) + "=(" + ptrStr.join("") + ")|0")
      vars.push(cube(i,j) + "=0")
    }
  }
  //Create step variables
  for(var i=0; i<arrayArgs; ++i) {
    for(var j=0; j<dimension; ++j) {
      var stepVal = [ stride(i,order[j]) ]
      if(j > 0) {
        stepVal.push(stride(i, order[j-1]) + "*" + shape(order[j-1]) )
      }
      vars.push(step(i,order[j]) + "=(" + stepVal.join("-") + ")|0")
    }
  }
  //Create index variables
  for(var i=0; i<dimension; ++i) {
    vars.push(index(i) + "=0")
  }
  //Vertex count
  vars.push(VERTEX_COUNT + "=0")
  //Compute pool size, initialize pool step
  var sizeVariable = ["2"]
  for(var i=dimension-2; i>=0; --i) {
    sizeVariable.push(shape(order[i]))
  }
  //Previous phases and vertex_ids
  vars.push(POOL_SIZE + "=(" + sizeVariable.join("*") + ")|0",
            PHASES + "=mallocUint32(" + POOL_SIZE + ")",
            VERTEX_IDS + "=mallocUint32(" + POOL_SIZE + ")",
            POINTER + "=0")
  //Create cube variables for phases
  vars.push(pcube(0) + "=0")
  for(var j=1; j<(1<<dimension); ++j) {
    var cubeDelta = []
    var cubeStep = [ ]
    for(var k=0; k<dimension; ++k) {
      if(j & (1<<k)) {
        if(cubeStep.length === 0) {
          cubeDelta.push("1")
        } else {
          cubeDelta.unshift(cubeStep.join("*"))
        }
      }
      cubeStep.push(shape(order[k]))
    }
    var signFlag = ""
    if(cubeDelta[0].indexOf(shape(order[dimension-2])) < 0) {
      signFlag = "-"
    }
    var jperm = permBitmask(dimension, j, order)
    vars.push(pdelta(jperm) + "=(-" + cubeDelta.join("-") + ")|0",
              qcube(jperm) + "=(" + signFlag + cubeDelta.join("-") + ")|0",
              pcube(jperm) + "=0")
  }
  vars.push(vert(0) + "=0", TEMPORARY + "=0")

  function forLoopBegin(i, start) {
    code.push("for(", index(order[i]), "=", start, ";",
      index(order[i]), "<", shape(order[i]), ";",
      "++", index(order[i]), "){")
  }

  function forLoopEnd(i) {
    for(var j=0; j<arrayArgs; ++j) {
      code.push(pointer(j), "+=", step(j,order[i]), ";")
    }
    code.push("}")
  }

  function fillEmptySlice(k) {
    for(var i=k-1; i>=0; --i) {
      forLoopBegin(i, 0) 
    }
    var phaseFuncArgs = []
    for(var i=0; i<arrayArgs; ++i) {
      if(typesig[i]) {
        phaseFuncArgs.push(data(i) + ".get(" + pointer(i) + ")")
      } else {
        phaseFuncArgs.push(data(i) + "[" + pointer(i) + "]")
      }
    }
    for(var i=0; i<scalarArgs; ++i) {
      phaseFuncArgs.push(scalar(i))
    }
    code.push(PHASES, "[", POINTER, "++]=phase(", phaseFuncArgs.join(), ");")
    for(var i=0; i<k; ++i) {
      forLoopEnd(i)
    }
    for(var j=0; j<arrayArgs; ++j) {
      code.push(pointer(j), "+=", step(j,order[k]), ";")
    }
  }

  function processGridCell(mask) {
    //Read in local data
    for(var i=0; i<arrayArgs; ++i) {
      if(typesig[i]) {
        code.push(cube(i,0), "=", data(i), ".get(", pointer(i), ");")
      } else {
        code.push(cube(i,0), "=", data(i), "[", pointer(i), "];")
      }
    }

    //Read in phase
    var phaseFuncArgs = []
    for(var i=0; i<arrayArgs; ++i) {
      phaseFuncArgs.push(cube(i,0))
    }
    for(var i=0; i<scalarArgs; ++i) {
      phaseFuncArgs.push(scalar(i))
    }
    
    code.push(pcube(0), "=", PHASES, "[", POINTER, "]=phase(", phaseFuncArgs.join(), ");")
    
    //Read in other cube data
    for(var j=1; j<(1<<dimension); ++j) {
      code.push(pcube(j), "=", PHASES, "[", POINTER, "+", pdelta(j), "];")
    }

    //Check for boundary crossing
    var vertexPredicate = []
    for(var j=1; j<(1<<dimension); ++j) {
      vertexPredicate.push("(" + pcube(0) + "!==" + pcube(j) + ")")
    }
    code.push("if(", vertexPredicate.join("||"), "){")

    //Read in boundary data
    var vertexArgs = []
    for(var i=0; i<dimension; ++i) {
      vertexArgs.push(index(i))
    }
    for(var i=0; i<arrayArgs; ++i) {
      vertexArgs.push(cube(i,0))
      for(var j=1; j<(1<<dimension); ++j) {
        if(typesig[i]) {
          code.push(cube(i,j), "=", data(i), ".get(", pointer(i), "+", delta(i,j), ");")
        } else {
          code.push(cube(i,j), "=", data(i), "[", pointer(i), "+", delta(i,j), "];")
        }
        vertexArgs.push(cube(i,j))
      }
    }
    for(var i=0; i<(1<<dimension); ++i) {
      vertexArgs.push(pcube(i))
    }
    for(var i=0; i<scalarArgs; ++i) {
      vertexArgs.push(scalar(i))
    }

    //Generate vertex
    code.push("vertex(", vertexArgs.join(), ");",
      vert(0), "=", VERTEX_IDS, "[", POINTER, "]=", VERTEX_COUNT, "++;")

    //Check for face crossings
    var base = (1<<dimension)-1
    var corner = pcube(base)
    for(var j=0; j<dimension; ++j) {
      if((mask & ~(1<<j))===0) {
        //Check face
        var subset = base^(1<<j)
        var edge = pcube(subset)
        var faceArgs = [ ]
        for(var k=subset; k>0; k=(k-1)&subset) {
          faceArgs.push(VERTEX_IDS + "[" + POINTER + "+" + pdelta(k) + "]")
        }
        faceArgs.push(vert(0))
        for(var k=0; k<arrayArgs; ++k) {
          if(j&1) {
            faceArgs.push(cube(k,base), cube(k,subset))
          } else {
            faceArgs.push(cube(k,subset), cube(k,base))
          }
        }
        if(j&1) {
          faceArgs.push(corner, edge)
        } else {
          faceArgs.push(edge, corner)
        }
        for(var k=0; k<scalarArgs; ++k) {
          faceArgs.push(scalar(k))
        }
        code.push("if(", corner, "!==", edge, "){",
          "face(", faceArgs.join(), ")}")
      }
    }
    
    //Increment pointer, close off if statement
    code.push("}",
      POINTER, "+=1;")
  }

  function flip() {
    for(var j=1; j<(1<<dimension); ++j) {
      code.push(TEMPORARY, "=", pdelta(j), ";",
                pdelta(j), "=", qcube(j), ";",
                qcube(j), "=", TEMPORARY, ";")
    }
  }

  function createLoop(i, mask) {
    if(i < 0) {
      processGridCell(mask)
      return
    }
    fillEmptySlice(i)
    code.push("if(", shape(order[i]), ">0){",
      index(order[i]), "=1;")
    createLoop(i-1, mask|(1<<order[i]))

    for(var j=0; j<arrayArgs; ++j) {
      code.push(pointer(j), "+=", step(j,order[i]), ";")
    }
    if(i === dimension-1) {
      code.push(POINTER, "=0;")
      flip()
    }
    forLoopBegin(i, 2)
    createLoop(i-1, mask)
    if(i === dimension-1) {
      code.push("if(", index(order[dimension-1]), "&1){",
        POINTER, "=0;}")
      flip()
    }
    forLoopEnd(i)
    code.push("}")
  }

  createLoop(dimension-1, 0)

  //Release scratch memory
  code.push("freeUint32(", VERTEX_IDS, ");freeUint32(", PHASES, ");")

  //Compile and link procedure
  var procedureCode = [
    "'use strict';",
    "function ", funcName, "(", args.join(), "){",
      "var ", vars.join(), ";",
      code.join(""),
    "}",
    "return ", funcName ].join("")

  var proc = new Function(
    "vertex", 
    "face", 
    "phase", 
    "mallocUint32", 
    "freeUint32",
    procedureCode)
  return proc(
    vertexFunc, 
    faceFunc, 
    phaseFunc, 
    pool.mallocUint32, 
    pool.freeUint32)
}

function createSurfaceExtractor(args) {
  function error(msg) {
    throw new Error("ndarray-extract-contour: " + msg)
  }
  if(typeof args !== "object") {
    error("Must specify arguments")
  }
  var order = args.order
  if(!Array.isArray(order)) {
    error("Must specify order")
  }
  var arrays = args.arrayArguments||1
  if(arrays < 1) {
    error("Must have at least one array argument")
  }
  var scalars = args.scalarArguments||0
  if(scalars < 0) {
    error("Scalar arg count must be > 0")
  }
  if(typeof args.vertex !== "function") {
    error("Must specify vertex creation function")
  }
  if(typeof args.cell !== "function") {
    error("Must specify cell creation function")
  }
  if(typeof args.phase !== "function") {
    error("Must specify phase function")
  }
  var getters = args.getters || []
  var typesig = new Array(arrays)
  for(var i=0; i<arrays; ++i) {
    if(getters.indexOf(i) >= 0) {
      typesig[i] = true
    } else {
      typesig[i] = false
    }
  }
  return compileSurfaceProcedure(
    args.vertex,
    args.cell,
    args.phase,
    scalars,
    order,
    typesig)
}
},{"typedarray-pool":82}],82:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":27,"buffer":250,"dup":10}],83:[function(require,module,exports){
// transliterated from the python snippet here:
// http://en.wikipedia.org/wiki/Lanczos_approximation

var g = 7;
var p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
];

var g_ln = 607/128;
var p_ln = [
    0.99999999999999709182,
    57.156235665862923517,
    -59.597960355475491248,
    14.136097974741747174,
    -0.49191381609762019978,
    0.33994649984811888699e-4,
    0.46523628927048575665e-4,
    -0.98374475304879564677e-4,
    0.15808870322491248884e-3,
    -0.21026444172410488319e-3,
    0.21743961811521264320e-3,
    -0.16431810653676389022e-3,
    0.84418223983852743293e-4,
    -0.26190838401581408670e-4,
    0.36899182659531622704e-5
];

// Spouge approximation (suitable for large arguments)
function lngamma(z) {

    if(z < 0) return Number('0/0');
    var x = p_ln[0];
    for(var i = p_ln.length - 1; i > 0; --i) x += p_ln[i] / (z + i);
    var t = z + g_ln + 0.5;
    return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x)-Math.log(z);
}

module.exports = function gamma (z) {
    if (z < 0.5) {
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    else if(z > 100) return Math.exp(lngamma(z));
    else {
        z -= 1;
        var x = p[0];
        for (var i = 1; i < g + 2; i++) {
            x += p[i] / (z + i);
        }
        var t = z + g + 0.5;

        return Math.sqrt(2 * Math.PI)
            * Math.pow(t, z + 0.5)
            * Math.exp(-t)
            * x
        ;
    }
};

module.exports.log = lngamma;

},{}],84:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":27,"buffer":250,"dup":10}],85:[function(require,module,exports){
"use strict"

module.exports = permutationSign

var BRUTE_FORCE_CUTOFF = 32

var pool = require("typedarray-pool")

function permutationSign(p) {
  var n = p.length
  if(n < BRUTE_FORCE_CUTOFF) {
    //Use quadratic algorithm for small n
    var sgn = 1
    for(var i=0; i<n; ++i) {
      for(var j=0; j<i; ++j) {
        if(p[i] < p[j]) {
          sgn = -sgn
        } else if(p[i] === p[j]) {
          return 0
        }
      }
    }
    return sgn
  } else {
    //Otherwise use linear time algorithm
    var visited = pool.mallocUint8(n)
    for(var i=0; i<n; ++i) {
      visited[i] = 0
    }
    var sgn = 1
    for(var i=0; i<n; ++i) {
      if(!visited[i]) {
        var count = 1
        visited[i] = 1
        for(var j=p[i]; j!==i; j=p[j]) {
          if(visited[j]) {
            pool.freeUint8(visited)
            return 0
          }
          count += 1
          visited[j] = 1
        }
        if(!(count & 1)) {
          sgn = -sgn
        }
      }
    }
    pool.freeUint8(visited)
    return sgn
  }
}
},{"typedarray-pool":84}],86:[function(require,module,exports){
"use strict"

var pool = require("typedarray-pool")
var inverse = require("invert-permutation")

function rank(permutation) {
  var n = permutation.length
  switch(n) {
    case 0:
    case 1:
      return 0
    case 2:
      return permutation[1]
    default:
      break
  }
  var p = pool.mallocUint32(n)
  var pinv = pool.mallocUint32(n)
  var r = 0, s, t, i
  inverse(permutation, pinv)
  for(i=0; i<n; ++i) {
    p[i] = permutation[i]
  }
  for(i=n-1; i>0; --i) {
    t = pinv[i]
    s = p[i]
    p[i] = p[t]
    p[t] = s
    pinv[i] = pinv[s]
    pinv[s] = t
    r = (r + s) * i
  }
  pool.freeUint32(pinv)
  pool.freeUint32(p)
  return r
}

function unrank(n, r, p) {
  switch(n) {
    case 0:
      if(p) { return p }
      return []
    case 1:
      if(p) {
        p[0] = 0
        return p
      } else {
        return [0]
      }
    case 2:
      if(p) {
        if(r) {
          p[0] = 0
          p[1] = 1
        } else {
          p[0] = 1
          p[1] = 0
        }
        return p
      } else {
        return r ? [0,1] : [1,0]
      }
    default:
      break
  }
  p = p || new Array(n)
  var s, t, i, nf=1
  p[0] = 0
  for(i=1; i<n; ++i) {
    p[i] = i
    nf = (nf*i)|0
  }
  for(i=n-1; i>0; --i) {
    s = (r / nf)|0
    r = (r - s * nf)|0
    nf = (nf / i)|0
    t = p[i]|0
    p[i] = p[s]|0
    p[s] = t|0
  }
  return p
}

exports.rank = rank
exports.unrank = unrank

},{"invert-permutation":87,"typedarray-pool":88}],87:[function(require,module,exports){
"use strict"

function invertPermutation(pi, result) {
  result = result || new Array(pi.length)
  for(var i=0; i<pi.length; ++i) {
    result[pi[i]] = i
  }
  return result
}

module.exports = invertPermutation
},{}],88:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":27,"buffer":250,"dup":10}],89:[function(require,module,exports){
"use strict"

module.exports = triangulateCube

var perm = require("permutation-rank")
var sgn = require("permutation-parity")
var gamma = require("gamma")

function triangulateCube(dimension) {
  if(dimension < 0) {
    return [ ]
  }
  if(dimension === 0) {
    return [ [0] ]
  }
  var dfactorial = Math.round(gamma(dimension+1))|0
  var result = []
  for(var i=0; i<dfactorial; ++i) {
    var p = perm.unrank(dimension, i)
    var cell = [ 0 ]
    var v = 0
    for(var j=0; j<p.length; ++j) {
      v += (1<<p[j])
      cell.push(v)
    }
    if(sgn(p) < 1) {
      cell[0] = v
      cell[dimension] = 0
    }
    result.push(cell)
  }
  return result
}
},{"gamma":83,"permutation-parity":85,"permutation-rank":86}],90:[function(require,module,exports){
module.exports = require('cwise-compiler')({
    args: ['array', {
        offset: [1],
        array: 0
    }, 'scalar', 'scalar', 'index'],
    pre: {
        "body": "{}",
        "args": [],
        "thisVars": [],
        "localVars": []
    },
    post: {
        "body": "{}",
        "args": [],
        "thisVars": [],
        "localVars": []
    },
    body: {
        "body": "{\n        var _inline_1_da = _inline_1_arg0_ - _inline_1_arg3_\n        var _inline_1_db = _inline_1_arg1_ - _inline_1_arg3_\n        if((_inline_1_da >= 0) !== (_inline_1_db >= 0)) {\n          _inline_1_arg2_.push(_inline_1_arg4_[0] + 0.5 + 0.5 * (_inline_1_da + _inline_1_db) / (_inline_1_da - _inline_1_db))\n        }\n      }",
        "args": [{
            "name": "_inline_1_arg0_",
            "lvalue": false,
            "rvalue": true,
            "count": 1
        }, {
            "name": "_inline_1_arg1_",
            "lvalue": false,
            "rvalue": true,
            "count": 1
        }, {
            "name": "_inline_1_arg2_",
            "lvalue": false,
            "rvalue": true,
            "count": 1
        }, {
            "name": "_inline_1_arg3_",
            "lvalue": false,
            "rvalue": true,
            "count": 2
        }, {
            "name": "_inline_1_arg4_",
            "lvalue": false,
            "rvalue": true,
            "count": 1
        }],
        "thisVars": [],
        "localVars": ["_inline_1_da", "_inline_1_db"]
    },
    funcName: 'zeroCrossings'
})

},{"cwise-compiler":91}],91:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":93,"dup":4}],92:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":94}],93:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":92,"dup":6}],94:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],95:[function(require,module,exports){
"use strict"

module.exports = findZeroCrossings

var core = require("./lib/zc-core")

function findZeroCrossings(array, level) {
  var cross = []
  level = +level || 0.0
  core(array.hi(array.shape[0]-1), cross, level)
  return cross
}
},{"./lib/zc-core":90}],96:[function(require,module,exports){
"use strict"

module.exports = surfaceNets

var generateContourExtractor = require("ndarray-extract-contour")
var triangulateCube = require("triangulate-hypercube")
var zeroCrossings = require("zero-crossings")

function buildSurfaceNets(order, dtype) {
  var dimension = order.length
  var code = ["'use strict';"]
  var funcName = "surfaceNets" + order.join("_") + "d" + dtype

  //Contour extraction function
  code.push(
    "var contour=genContour({",
      "order:[", order.join(), "],",
      "scalarArguments: 3,",
      "phase:function phaseFunc(p,a,b,c) { return (p > c)|0 },")
  if(dtype === "generic") {
    code.push("getters:[0],")
  }

  //Generate vertex function
  var cubeArgs = []
  var extraArgs = []
  for(var i=0; i<dimension; ++i) {
    cubeArgs.push("d" + i)
    extraArgs.push("d" + i)
  }
  for(var i=0; i<(1<<dimension); ++i) {
    cubeArgs.push("v" + i)
    extraArgs.push("v" + i)
  }
  for(var i=0; i<(1<<dimension); ++i) {
    cubeArgs.push("p" + i)
    extraArgs.push("p" + i)
  }
  cubeArgs.push("a", "b", "c")
  extraArgs.push("a", "c")
  code.push("vertex:function vertexFunc(", cubeArgs.join(), "){")
  //Mask args together
  var maskStr = []
  for(var i=0; i<(1<<dimension); ++i) {
    maskStr.push("(p" + i + "<<" + i + ")")
  }
  //Generate variables and giganto switch statement
  code.push("var m=(", maskStr.join("+"), ")|0;if(m===0||m===", (1<<(1<<dimension))-1, "){return}")
  var extraFuncs = []
  var currentFunc = []
  if(1<<(1<<dimension) <= 128) {
    code.push("switch(m){")
    currentFunc = code
  } else {
    code.push("switch(m>>>7){")
  }
  for(var i=0; i<1<<(1<<dimension); ++i) {
    if(1<<(1<<dimension) > 128) {
      if((i%128)===0) {
        if(extraFuncs.length > 0) {
          currentFunc.push("}}")
        }
        var efName = "vExtra" + extraFuncs.length
        code.push("case ", (i>>>7), ":", efName, "(m&0x7f,", extraArgs.join(), ");break;")
        currentFunc = [
          "function ", efName, "(m,", extraArgs.join(), "){switch(m){"
        ]
        extraFuncs.push(currentFunc)
      }  
    }
    currentFunc.push("case ", (i&0x7f), ":")
    var crossings = new Array(dimension)
    var denoms = new Array(dimension)
    var crossingCount = new Array(dimension)
    var bias = new Array(dimension)
    var totalCrossings = 0
    for(var j=0; j<dimension; ++j) {
      crossings[j] = []
      denoms[j] = []
      crossingCount[j] = 0
      bias[j] = 0
    }
    for(var j=0; j<(1<<dimension); ++j) {
      for(var k=0; k<dimension; ++k) {
        var u = j ^ (1<<k)
        if(u > j) {
          continue
        }
        if(!(i&(1<<u)) !== !(i&(1<<j))) {
          var sign = 1
          if(i&(1<<u)) {
            denoms[k].push("v" + u + "-v" + j)
          } else {
            denoms[k].push("v" + j + "-v" + u)
            sign = -sign
          }
          if(sign < 0) {
            crossings[k].push("-v" + j + "-v" + u)
            crossingCount[k] += 2
          } else {
            crossings[k].push("v" + j + "+v" + u)
            crossingCount[k] -= 2            
          }
          totalCrossings += 1
          for(var l=0; l<dimension; ++l) {
            if(l === k) {
              continue
            }
            if(u&(1<<l)) {
              bias[l] += 1
            } else {
              bias[l] -= 1
            }
          }
        }
      }
    }
    var vertexStr = []
    for(var k=0; k<dimension; ++k) {
      if(crossings[k].length === 0) {
        vertexStr.push("d" + k + "-0.5")
      } else {
        var cStr = ""
        if(crossingCount[k] < 0) {
          cStr = crossingCount[k] + "*c"
        } else if(crossingCount[k] > 0) {
          cStr = "+" + crossingCount[k] + "*c"
        }
        var weight = 0.5 * (crossings[k].length / totalCrossings)
        var shift = 0.5 + 0.5 * (bias[k] / totalCrossings)
        vertexStr.push("d" + k + "-" + shift + "-" + weight + "*(" + crossings[k].join("+") + cStr + ")/(" + denoms[k].join("+") + ")")
        
      }
    }
    currentFunc.push("a.push([", vertexStr.join(), "]);",
      "break;")
  }
  code.push("}},")
  if(extraFuncs.length > 0) {
    currentFunc.push("}}")
  }

  //Create face function
  var faceArgs = []
  for(var i=0; i<(1<<(dimension-1)); ++i) {
    faceArgs.push("v" + i)
  }
  faceArgs.push("c0", "c1", "p0", "p1", "a", "b", "c")
  code.push("cell:function cellFunc(", faceArgs.join(), "){")

  var facets = triangulateCube(dimension-1)
  code.push("if(p0){b.push(",
    facets.map(function(f) {
      return "[" + f.map(function(v) {
        return "v" + v
      }) + "]"
    }).join(), ")}else{b.push(",
    facets.map(function(f) {
      var e = f.slice()
      e.reverse()
      return "[" + e.map(function(v) {
        return "v" + v
      }) + "]"
    }).join(),
    ")}}});function ", funcName, "(array,level){var verts=[],cells=[];contour(array,verts,cells,level);return {positions:verts,cells:cells};} return ", funcName, ";")

  for(var i=0; i<extraFuncs.length; ++i) {
    code.push(extraFuncs[i].join(""))
  }

  //Compile and link
  var proc = new Function("genContour", code.join(""))
  return proc(generateContourExtractor)
}

//1D case: Need to handle specially
function mesh1D(array, level) {
  var zc = zeroCrossings(array, level)
  var n = zc.length
  var npos = new Array(n)
  var ncel = new Array(n)
  for(var i=0; i<n; ++i) {
    npos[i] = [ zc[i] ]
    ncel[i] = [ i ]
  }
  return {
    positions: npos,
    cells: ncel
  }
}

var CACHE = {}

function surfaceNets(array,level) {
  if(array.dimension <= 0) {
    return { positions: [], cells: [] }
  } else if(array.dimension === 1) {
    return mesh1D(array, level)
  }
  var typesig = array.order.join() + "-" + array.dtype
  var proc = CACHE[typesig]
  var level = (+level) || 0.0
  if(!proc) {
    proc = CACHE[typesig] = buildSurfaceNets(array.order, array.dtype)
  }
  return proc(array,level)
}
},{"ndarray-extract-contour":81,"triangulate-hypercube":89,"zero-crossings":95}],97:[function(require,module,exports){
module.exports={"version": "1.3.3"}
},{}],98:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:11 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */


// -------------------------------------------------------------------------Node

/**
 * Advancing front node
 * @param {Point} p any "Point like" object with {x,y} (duck typing)
 * @param {Triangle} t triangle (optionnal)
 */
var Node = function(p, t) {
    this.point = p;
    this.triangle = t || null;

    this.next = null; // Node
    this.prev = null; // Node

    this.value = p.x;
};

// ---------------------------------------------------------------AdvancingFront
var AdvancingFront = function(head, tail) {
    this.head_ = head; // Node
    this.tail_ = tail; // Node
    this.search_node_ = head; // Node
};

AdvancingFront.prototype.head = function() {
    return this.head_;
};

AdvancingFront.prototype.setHead = function(node) {
    this.head_ = node;
};

AdvancingFront.prototype.tail = function() {
    return this.tail_;
};

AdvancingFront.prototype.setTail = function(node) {
    this.tail_ = node;
};

AdvancingFront.prototype.search = function() {
    return this.search_node_;
};

AdvancingFront.prototype.setSearch = function(node) {
    this.search_node_ = node;
};

AdvancingFront.prototype.findSearchNode = function(/*x*/) {
    // TODO: implement BST index
    return this.search_node_;
};

AdvancingFront.prototype.locateNode = function(x) {
    var node = this.search_node_;

    /* jshint boss:true */
    if (x < node.value) {
        while (node = node.prev) {
            if (x >= node.value) {
                this.search_node_ = node;
                return node;
            }
        }
    } else {
        while (node = node.next) {
            if (x < node.value) {
                this.search_node_ = node.prev;
                return node.prev;
            }
        }
    }
    return null;
};

AdvancingFront.prototype.locatePoint = function(point) {
    var px = point.x;
    var node = this.findSearchNode(px);
    var nx = node.point.x;

    if (px === nx) {
        // Here we are comparing point references, not values
        if (point !== node.point) {
            // We might have two nodes with same x value for a short time
            if (point === node.prev.point) {
                node = node.prev;
            } else if (point === node.next.point) {
                node = node.next;
            } else {
                throw new Error('poly2tri Invalid AdvancingFront.locatePoint() call');
            }
        }
    } else if (px < nx) {
        /* jshint boss:true */
        while (node = node.prev) {
            if (point === node.point) {
                break;
            }
        }
    } else {
        while (node = node.next) {
            if (point === node.point) {
                break;
            }
        }
    }

    if (node) {
        this.search_node_ = node;
    }
    return node;
};


// ----------------------------------------------------------------------Exports

module.exports = AdvancingFront;
module.exports.Node = Node;


},{}],99:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var xy = require('./xy');

// ------------------------------------------------------------------------Point
/**
 * Construct a point
 * @param {Number} x    coordinate (0 if undefined)
 * @param {Number} y    coordinate (0 if undefined)
 */
var Point = function(x, y) {
    this.x = +x || 0;
    this.y = +y || 0;

    // All extra fields added to Point are prefixed with _p2t_
    // to avoid collisions if custom Point class is used.

    // The edges this point constitutes an upper ending point
    this._p2t_edge_list = null;
};

/**
 * For pretty printing ex. <i>"(5;42)"</i>)
 */
Point.prototype.toString = function() {
    return xy.toStringBase(this);
};

/**
 * Creates a copy of this Point object.
 * @returns Point
 */
Point.prototype.clone = function() {
    return new Point(this.x, this.y);
};

/**
 * Set this Point instance to the origo. <code>(0; 0)</code>
 */
Point.prototype.set_zero = function() {
    this.x = 0.0;
    this.y = 0.0;
    return this; // for chaining
};

/**
 * Set the coordinates of this instance.
 * @param   x   number.
 * @param   y   number;
 */
Point.prototype.set = function(x, y) {
    this.x = +x || 0;
    this.y = +y || 0;
    return this; // for chaining
};

/**
 * Negate this Point instance. (component-wise)
 */
Point.prototype.negate = function() {
    this.x = -this.x;
    this.y = -this.y;
    return this; // for chaining
};

/**
 * Add another Point object to this instance. (component-wise)
 * @param   n   Point object.
 */
Point.prototype.add = function(n) {
    this.x += n.x;
    this.y += n.y;
    return this; // for chaining
};

/**
 * Subtract this Point instance with another point given. (component-wise)
 * @param   n   Point object.
 */
Point.prototype.sub = function(n) {
    this.x -= n.x;
    this.y -= n.y;
    return this; // for chaining
};

/**
 * Multiply this Point instance by a scalar. (component-wise)
 * @param   s   scalar.
 */
Point.prototype.mul = function(s) {
    this.x *= s;
    this.y *= s;
    return this; // for chaining
};

/**
 * Return the distance of this Point instance from the origo.
 */
Point.prototype.length = function() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
};

/**
 * Normalize this Point instance (as a vector).
 * @return The original distance of this instance from the origo.
 */
Point.prototype.normalize = function() {
    var len = this.length();
    this.x /= len;
    this.y /= len;
    return len;
};

/**
 * Test this Point object with another for equality.
 * @param   p   any "Point like" object with {x,y} (duck typing)
 * @return <code>True</code> if <code>this == p</code>, <code>false</code> otherwise.
 */
Point.prototype.equals = function(p) {
    return this.x === p.x && this.y === p.y;
};


// -----------------------------------------------------Point ("static" methods)

/**
 * Negate a point component-wise and return the result as a new Point object.
 * @param   p   Point object.
 * @return the resulting Point object.
 */
Point.negate = function(p) {
    return new Point(-p.x, -p.y);
};

/**
 * Add two points component-wise and return the result as a new Point object.
 * @param   a   Point object.
 * @param   b   Point object.
 * @return the resulting Point object.
 */
Point.add = function(a, b) {
    return new Point(a.x + b.x, a.y + b.y);
};

/**
 * Subtract two points component-wise and return the result as a new Point object.
 * @param   a   Point object.
 * @param   b   Point object.
 * @return the resulting Point object.
 */
Point.sub = function(a, b) {
    return new Point(a.x - b.x, a.y - b.y);
};

/**
 * Multiply a point by a scalar and return the result as a new Point object.
 * @param   s   the scalar (a number).
 * @param   p   Point object.
 * @return the resulting Point object.
 */
Point.mul = function(s, p) {
    return new Point(s * p.x, s * p.y);
};

/**
 * Perform the cross product on either two points (this produces a scalar)
 * or a point and a scalar (this produces a point).
 * This function requires two parameters, either may be a Point object or a
 * number.
 * @param   a   Point object or scalar.
 * @param   b   Point object or scalar.
 * @return  a   Point object or a number, depending on the parameters.
 */
Point.cross = function(a, b) {
    if (typeof(a) === 'number') {
        if (typeof(b) === 'number') {
            return a * b;
        } else {
            return new Point(-a * b.y, a * b.x);
        }
    } else {
        if (typeof(b) === 'number') {
            return new Point(b * a.y, -b * a.x);
        } else {
            return a.x * b.y - a.y * b.x;
        }
    }
};


// -----------------------------------------------------------------"Point-Like"
/*
 * The following functions operate on "Point" or any "Point like" object 
 * with {x,y} (duck typing).
 */

Point.toString = xy.toString;
Point.compare = xy.compare;
Point.cmp = xy.compare; // backward compatibility
Point.equals = xy.equals;

/**
 * Peform the dot product on two vectors.
 * @param   a,b   any "Point like" objects with {x,y} 
 * @return The dot product (as a number).
 */
Point.dot = function(a, b) {
    return a.x * b.x + a.y * b.y;
};


// ---------------------------------------------------------Exports (public API)

module.exports = Point;

},{"./xy":106}],100:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/*
 * Class added in the JavaScript version (was not present in the c++ version)
 */

var xy = require('./xy');

/**
 * Custom exception class to indicate invalid Point values
 * @param {String} message          error message
 * @param {array<Point>} points     invalid points
 */
var PointError = function(message, points) {
    this.name = "PointError";
    this.points = points = points || [];
    this.message = message || "Invalid Points!";
    for (var i = 0; i < points.length; i++) {
        this.message += " " + xy.toString(points[i]);
    }
};
PointError.prototype = new Error();
PointError.prototype.constructor = PointError;


module.exports = PointError;

},{"./xy":106}],101:[function(require,module,exports){
(function (global){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 *
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 * * Neither the name of Poly2Tri nor the names of its contributors may be
 *   used to endorse or promote products derived from this software without specific
 *   prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

"use strict";

/*
 * Public API for poly2tri.js
 * ==========================
 */


/*
 * for Browser + <script> : 
 * return the poly2tri global variable to its previous value. 
 * (this feature is not automatically provided by browserify).
 */
var previousPoly2tri = global.poly2tri;
exports.noConflict = function() {
    global.poly2tri = previousPoly2tri;
    return exports;
};

exports.VERSION = require('../dist/version.json').version;

exports.PointError = require('./pointerror');
exports.Point = require('./point');
exports.Triangle = require('./triangle');
exports.SweepContext = require('./sweepcontext');


// Backward compatibility
var sweep = require('./sweep');
exports.triangulate = sweep.triangulate;
exports.sweep = {Triangulate: sweep.triangulate};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../dist/version.json":97,"./point":99,"./pointerror":100,"./sweep":102,"./sweepcontext":103,"./triangle":104}],102:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint latedef:nofunc, maxcomplexity:9 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 *
 * This 'Sweep' module is present in order to keep this JavaScript version 
 * as close as possible to the reference C++ version, even though almost all
 * functions could be declared as methods on the SweepContext object.
 */

var PointError = require('./pointerror');
var Triangle = require('./triangle');
var Node = require('./advancingfront').Node;


// ------------------------------------------------------------------------utils

var utils = require('./utils');

var PI_3div4 = 3 * Math.PI / 4;
var PI_div2 = Math.PI / 2;
var EPSILON = utils.EPSILON;

var Orientation = utils.Orientation;
var orient2d = utils.orient2d;
var inScanArea = utils.inScanArea;


// ------------------------------------------------------------------------Sweep

/**
 * Triangulate the polygon with holes and Steiner points.
 * Do this AFTER you've added the polyline, holes, and Steiner points
 * @param   tcx SweepContext object.
 */
function triangulate(tcx) {
    tcx.initTriangulation();
    tcx.createAdvancingFront();
    // Sweep points; build mesh
    sweepPoints(tcx);
    // Clean up
    finalizationPolygon(tcx);
}

/**
 * Start sweeping the Y-sorted point set from bottom to top
 * @param   tcx SweepContext object.
 */
function sweepPoints(tcx) {
    var i, len = tcx.pointCount();
    for (i = 1; i < len; ++i) {
        var point = tcx.getPoint(i);
        var node = pointEvent(tcx, point);
        var edges = point._p2t_edge_list;
        for (var j = 0; edges && j < edges.length; ++j) {
            edgeEventByEdge(tcx, edges[j], node);
        }
    }
}

function finalizationPolygon(tcx) {
    // Get an Internal triangle to start with
    var t = tcx.front().head().next.triangle;
    var p = tcx.front().head().next.point;
    while (!t.getConstrainedEdgeCW(p)) {
        t = t.neighborCCW(p);
    }

    // Collect interior triangles constrained by edges
    tcx.meshClean(t);
}

/**
 * Find closes node to the left of the new point and
 * create a new triangle. If needed new holes and basins
 * will be filled to.
 */
function pointEvent(tcx, point) {
    var node = tcx.locateNode(point);
    var new_node = newFrontTriangle(tcx, point, node);

    // Only need to check +epsilon since point never have smaller
    // x value than node due to how we fetch nodes from the front
    if (point.x <= node.point.x + (EPSILON)) {
        fill(tcx, node);
    }

    //tcx.AddNode(new_node);

    fillAdvancingFront(tcx, new_node);
    return new_node;
}

function edgeEventByEdge(tcx, edge, node) {
    tcx.edge_event.constrained_edge = edge;
    tcx.edge_event.right = (edge.p.x > edge.q.x);

    if (isEdgeSideOfTriangle(node.triangle, edge.p, edge.q)) {
        return;
    }

    // For now we will do all needed filling
    // TODO: integrate with flip process might give some better performance
    //       but for now this avoid the issue with cases that needs both flips and fills
    fillEdgeEvent(tcx, edge, node);
    edgeEventByPoints(tcx, edge.p, edge.q, node.triangle, edge.q);
}

function edgeEventByPoints(tcx, ep, eq, triangle, point) {
    if (isEdgeSideOfTriangle(triangle, ep, eq)) {
        return;
    }

    var p1 = triangle.pointCCW(point);
    var o1 = orient2d(eq, p1, ep);
    if (o1 === Orientation.COLLINEAR) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision 09880a869095 dated March 8, 2011)
        throw new PointError('poly2tri EdgeEvent: Collinear not supported!', [eq, p1, ep]);
    }

    var p2 = triangle.pointCW(point);
    var o2 = orient2d(eq, p2, ep);
    if (o2 === Orientation.COLLINEAR) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision 09880a869095 dated March 8, 2011)
        throw new PointError('poly2tri EdgeEvent: Collinear not supported!', [eq, p2, ep]);
    }

    if (o1 === o2) {
        // Need to decide if we are rotating CW or CCW to get to a triangle
        // that will cross edge
        if (o1 === Orientation.CW) {
            triangle = triangle.neighborCCW(point);
        } else {
            triangle = triangle.neighborCW(point);
        }
        edgeEventByPoints(tcx, ep, eq, triangle, point);
    } else {
        // This triangle crosses constraint so lets flippin start!
        flipEdgeEvent(tcx, ep, eq, triangle, point);
    }
}

function isEdgeSideOfTriangle(triangle, ep, eq) {
    var index = triangle.edgeIndex(ep, eq);
    if (index !== -1) {
        triangle.markConstrainedEdgeByIndex(index);
        var t = triangle.getNeighbor(index);
        if (t) {
            t.markConstrainedEdgeByPoints(ep, eq);
        }
        return true;
    }
    return false;
}

/**
 * Creates a new front triangle and legalize it
 */
function newFrontTriangle(tcx, point, node) {
    var triangle = new Triangle(point, node.point, node.next.point);

    triangle.markNeighbor(node.triangle);
    tcx.addToMap(triangle);

    var new_node = new Node(point);
    new_node.next = node.next;
    new_node.prev = node;
    node.next.prev = new_node;
    node.next = new_node;

    if (!legalize(tcx, triangle)) {
        tcx.mapTriangleToNodes(triangle);
    }

    return new_node;
}

/**
 * Adds a triangle to the advancing front to fill a hole.
 * @param tcx
 * @param node - middle node, that is the bottom of the hole
 */
function fill(tcx, node) {
    var triangle = new Triangle(node.prev.point, node.point, node.next.point);

    // TODO: should copy the constrained_edge value from neighbor triangles
    //       for now constrained_edge values are copied during the legalize
    triangle.markNeighbor(node.prev.triangle);
    triangle.markNeighbor(node.triangle);

    tcx.addToMap(triangle);

    // Update the advancing front
    node.prev.next = node.next;
    node.next.prev = node.prev;


    // If it was legalized the triangle has already been mapped
    if (!legalize(tcx, triangle)) {
        tcx.mapTriangleToNodes(triangle);
    }

    //tcx.removeNode(node);
}

/**
 * Fills holes in the Advancing Front
 */
function fillAdvancingFront(tcx, n) {
    // Fill right holes
    var node = n.next;
    var angle;
    while (node.next) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision acf81f1f1764 dated April 7, 2012)
        angle = holeAngle(node);
        if (angle > PI_div2 || angle < -(PI_div2)) {
            break;
        }
        fill(tcx, node);
        node = node.next;
    }

    // Fill left holes
    node = n.prev;
    while (node.prev) {
        // TODO integrate here changes from C++ version
        // (C++ repo revision acf81f1f1764 dated April 7, 2012)
        angle = holeAngle(node);
        if (angle > PI_div2 || angle < -(PI_div2)) {
            break;
        }
        fill(tcx, node);
        node = node.prev;
    }

    // Fill right basins
    if (n.next && n.next.next) {
        angle = basinAngle(n);
        if (angle < PI_3div4) {
            fillBasin(tcx, n);
        }
    }
}

/**
 * The basin angle is decided against the horizontal line [1,0]
 */
function basinAngle(node) {
    var ax = node.point.x - node.next.next.point.x;
    var ay = node.point.y - node.next.next.point.y;
    return Math.atan2(ay, ax);
}

/**
 *
 * @param node - middle node
 * @return the angle between 3 front nodes
 */
function holeAngle(node) {
    /* Complex plane
     * ab = cosA +i*sinA
     * ab = (ax + ay*i)(bx + by*i) = (ax*bx + ay*by) + i(ax*by-ay*bx)
     * atan2(y,x) computes the principal value of the argument function
     * applied to the complex number x+iy
     * Where x = ax*bx + ay*by
     *       y = ax*by - ay*bx
     */
    var ax = node.next.point.x - node.point.x;
    var ay = node.next.point.y - node.point.y;
    var bx = node.prev.point.x - node.point.x;
    var by = node.prev.point.y - node.point.y;
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/**
 * Returns true if triangle was legalized
 */
function legalize(tcx, t) {
    // To legalize a triangle we start by finding if any of the three edges
    // violate the Delaunay condition
    for (var i = 0; i < 3; ++i) {
        if (t.delaunay_edge[i]) {
            continue;
        }
        var ot = t.getNeighbor(i);
        if (ot) {
            var p = t.getPoint(i);
            var op = ot.oppositePoint(t, p);
            var oi = ot.index(op);

            // If this is a Constrained Edge or a Delaunay Edge(only during recursive legalization)
            // then we should not try to legalize
            if (ot.constrained_edge[oi] || ot.delaunay_edge[oi]) {
                t.constrained_edge[i] = ot.constrained_edge[oi];
                continue;
            }

            var inside = inCircle(p, t.pointCCW(p), t.pointCW(p), op);
            if (inside) {
                // Lets mark this shared edge as Delaunay
                t.delaunay_edge[i] = true;
                ot.delaunay_edge[oi] = true;

                // Lets rotate shared edge one vertex CW to legalize it
                rotateTrianglePair(t, p, ot, op);

                // We now got one valid Delaunay Edge shared by two triangles
                // This gives us 4 new edges to check for Delaunay

                // Make sure that triangle to node mapping is done only one time for a specific triangle
                var not_legalized = !legalize(tcx, t);
                if (not_legalized) {
                    tcx.mapTriangleToNodes(t);
                }

                not_legalized = !legalize(tcx, ot);
                if (not_legalized) {
                    tcx.mapTriangleToNodes(ot);
                }
                // Reset the Delaunay edges, since they only are valid Delaunay edges
                // until we add a new triangle or point.
                // XXX: need to think about this. Can these edges be tried after we
                //      return to previous recursive level?
                t.delaunay_edge[i] = false;
                ot.delaunay_edge[oi] = false;

                // If triangle have been legalized no need to check the other edges since
                // the recursive legalization will handles those so we can end here.
                return true;
            }
        }
    }
    return false;
}

/**
 * <b>Requirement</b>:<br>
 * 1. a,b and c form a triangle.<br>
 * 2. a and d is know to be on opposite side of bc<br>
 * <pre>
 *                a
 *                +
 *               / \
 *              /   \
 *            b/     \c
 *            +-------+
 *           /    d    \
 *          /           \
 * </pre>
 * <b>Fact</b>: d has to be in area B to have a chance to be inside the circle formed by
 *  a,b and c<br>
 *  d is outside B if orient2d(a,b,d) or orient2d(c,a,d) is CW<br>
 *  This preknowledge gives us a way to optimize the incircle test
 * @param pa - triangle point, opposite d
 * @param pb - triangle point
 * @param pc - triangle point
 * @param pd - point opposite a
 * @return true if d is inside circle, false if on circle edge
 */
function inCircle(pa, pb, pc, pd) {
    var adx = pa.x - pd.x;
    var ady = pa.y - pd.y;
    var bdx = pb.x - pd.x;
    var bdy = pb.y - pd.y;

    var adxbdy = adx * bdy;
    var bdxady = bdx * ady;
    var oabd = adxbdy - bdxady;
    if (oabd <= 0) {
        return false;
    }

    var cdx = pc.x - pd.x;
    var cdy = pc.y - pd.y;

    var cdxady = cdx * ady;
    var adxcdy = adx * cdy;
    var ocad = cdxady - adxcdy;
    if (ocad <= 0) {
        return false;
    }

    var bdxcdy = bdx * cdy;
    var cdxbdy = cdx * bdy;

    var alift = adx * adx + ady * ady;
    var blift = bdx * bdx + bdy * bdy;
    var clift = cdx * cdx + cdy * cdy;

    var det = alift * (bdxcdy - cdxbdy) + blift * ocad + clift * oabd;
    return det > 0;
}

/**
 * Rotates a triangle pair one vertex CW
 *<pre>
 *       n2                    n2
 *  P +-----+             P +-----+
 *    | t  /|               |\  t |
 *    |   / |               | \   |
 *  n1|  /  |n3           n1|  \  |n3
 *    | /   |    after CW   |   \ |
 *    |/ oT |               | oT \|
 *    +-----+ oP            +-----+
 *       n4                    n4
 * </pre>
 */
function rotateTrianglePair(t, p, ot, op) {
    var n1, n2, n3, n4;
    n1 = t.neighborCCW(p);
    n2 = t.neighborCW(p);
    n3 = ot.neighborCCW(op);
    n4 = ot.neighborCW(op);

    var ce1, ce2, ce3, ce4;
    ce1 = t.getConstrainedEdgeCCW(p);
    ce2 = t.getConstrainedEdgeCW(p);
    ce3 = ot.getConstrainedEdgeCCW(op);
    ce4 = ot.getConstrainedEdgeCW(op);

    var de1, de2, de3, de4;
    de1 = t.getDelaunayEdgeCCW(p);
    de2 = t.getDelaunayEdgeCW(p);
    de3 = ot.getDelaunayEdgeCCW(op);
    de4 = ot.getDelaunayEdgeCW(op);

    t.legalize(p, op);
    ot.legalize(op, p);

    // Remap delaunay_edge
    ot.setDelaunayEdgeCCW(p, de1);
    t.setDelaunayEdgeCW(p, de2);
    t.setDelaunayEdgeCCW(op, de3);
    ot.setDelaunayEdgeCW(op, de4);

    // Remap constrained_edge
    ot.setConstrainedEdgeCCW(p, ce1);
    t.setConstrainedEdgeCW(p, ce2);
    t.setConstrainedEdgeCCW(op, ce3);
    ot.setConstrainedEdgeCW(op, ce4);

    // Remap neighbors
    // XXX: might optimize the markNeighbor by keeping track of
    //      what side should be assigned to what neighbor after the
    //      rotation. Now mark neighbor does lots of testing to find
    //      the right side.
    t.clearNeigbors();
    ot.clearNeigbors();
    if (n1) {
        ot.markNeighbor(n1);
    }
    if (n2) {
        t.markNeighbor(n2);
    }
    if (n3) {
        t.markNeighbor(n3);
    }
    if (n4) {
        ot.markNeighbor(n4);
    }
    t.markNeighbor(ot);
}

/**
 * Fills a basin that has formed on the Advancing Front to the right
 * of given node.<br>
 * First we decide a left,bottom and right node that forms the
 * boundaries of the basin. Then we do a reqursive fill.
 *
 * @param tcx
 * @param node - starting node, this or next node will be left node
 */
function fillBasin(tcx, node) {
    if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
        tcx.basin.left_node = node.next.next;
    } else {
        tcx.basin.left_node = node.next;
    }

    // Find the bottom and right node
    tcx.basin.bottom_node = tcx.basin.left_node;
    while (tcx.basin.bottom_node.next && tcx.basin.bottom_node.point.y >= tcx.basin.bottom_node.next.point.y) {
        tcx.basin.bottom_node = tcx.basin.bottom_node.next;
    }
    if (tcx.basin.bottom_node === tcx.basin.left_node) {
        // No valid basin
        return;
    }

    tcx.basin.right_node = tcx.basin.bottom_node;
    while (tcx.basin.right_node.next && tcx.basin.right_node.point.y < tcx.basin.right_node.next.point.y) {
        tcx.basin.right_node = tcx.basin.right_node.next;
    }
    if (tcx.basin.right_node === tcx.basin.bottom_node) {
        // No valid basins
        return;
    }

    tcx.basin.width = tcx.basin.right_node.point.x - tcx.basin.left_node.point.x;
    tcx.basin.left_highest = tcx.basin.left_node.point.y > tcx.basin.right_node.point.y;

    fillBasinReq(tcx, tcx.basin.bottom_node);
}

/**
 * Recursive algorithm to fill a Basin with triangles
 *
 * @param tcx
 * @param node - bottom_node
 */
function fillBasinReq(tcx, node) {
    // if shallow stop filling
    if (isShallow(tcx, node)) {
        return;
    }

    fill(tcx, node);

    var o;
    if (node.prev === tcx.basin.left_node && node.next === tcx.basin.right_node) {
        return;
    } else if (node.prev === tcx.basin.left_node) {
        o = orient2d(node.point, node.next.point, node.next.next.point);
        if (o === Orientation.CW) {
            return;
        }
        node = node.next;
    } else if (node.next === tcx.basin.right_node) {
        o = orient2d(node.point, node.prev.point, node.prev.prev.point);
        if (o === Orientation.CCW) {
            return;
        }
        node = node.prev;
    } else {
        // Continue with the neighbor node with lowest Y value
        if (node.prev.point.y < node.next.point.y) {
            node = node.prev;
        } else {
            node = node.next;
        }
    }

    fillBasinReq(tcx, node);
}

function isShallow(tcx, node) {
    var height;
    if (tcx.basin.left_highest) {
        height = tcx.basin.left_node.point.y - node.point.y;
    } else {
        height = tcx.basin.right_node.point.y - node.point.y;
    }

    // if shallow stop filling
    if (tcx.basin.width > height) {
        return true;
    }
    return false;
}

function fillEdgeEvent(tcx, edge, node) {
    if (tcx.edge_event.right) {
        fillRightAboveEdgeEvent(tcx, edge, node);
    } else {
        fillLeftAboveEdgeEvent(tcx, edge, node);
    }
}

function fillRightAboveEdgeEvent(tcx, edge, node) {
    while (node.next.point.x < edge.p.x) {
        // Check if next node is below the edge
        if (orient2d(edge.q, node.next.point, edge.p) === Orientation.CCW) {
            fillRightBelowEdgeEvent(tcx, edge, node);
        } else {
            node = node.next;
        }
    }
}

function fillRightBelowEdgeEvent(tcx, edge, node) {
    if (node.point.x < edge.p.x) {
        if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
            // Concave
            fillRightConcaveEdgeEvent(tcx, edge, node);
        } else {
            // Convex
            fillRightConvexEdgeEvent(tcx, edge, node);
            // Retry this one
            fillRightBelowEdgeEvent(tcx, edge, node);
        }
    }
}

function fillRightConcaveEdgeEvent(tcx, edge, node) {
    fill(tcx, node.next);
    if (node.next.point !== edge.p) {
        // Next above or below edge?
        if (orient2d(edge.q, node.next.point, edge.p) === Orientation.CCW) {
            // Below
            if (orient2d(node.point, node.next.point, node.next.next.point) === Orientation.CCW) {
                // Next is concave
                fillRightConcaveEdgeEvent(tcx, edge, node);
            } else {
                // Next is convex
                /* jshint noempty:false */
            }
        }
    }
}

function fillRightConvexEdgeEvent(tcx, edge, node) {
    // Next concave or convex?
    if (orient2d(node.next.point, node.next.next.point, node.next.next.next.point) === Orientation.CCW) {
        // Concave
        fillRightConcaveEdgeEvent(tcx, edge, node.next);
    } else {
        // Convex
        // Next above or below edge?
        if (orient2d(edge.q, node.next.next.point, edge.p) === Orientation.CCW) {
            // Below
            fillRightConvexEdgeEvent(tcx, edge, node.next);
        } else {
            // Above
            /* jshint noempty:false */
        }
    }
}

function fillLeftAboveEdgeEvent(tcx, edge, node) {
    while (node.prev.point.x > edge.p.x) {
        // Check if next node is below the edge
        if (orient2d(edge.q, node.prev.point, edge.p) === Orientation.CW) {
            fillLeftBelowEdgeEvent(tcx, edge, node);
        } else {
            node = node.prev;
        }
    }
}

function fillLeftBelowEdgeEvent(tcx, edge, node) {
    if (node.point.x > edge.p.x) {
        if (orient2d(node.point, node.prev.point, node.prev.prev.point) === Orientation.CW) {
            // Concave
            fillLeftConcaveEdgeEvent(tcx, edge, node);
        } else {
            // Convex
            fillLeftConvexEdgeEvent(tcx, edge, node);
            // Retry this one
            fillLeftBelowEdgeEvent(tcx, edge, node);
        }
    }
}

function fillLeftConvexEdgeEvent(tcx, edge, node) {
    // Next concave or convex?
    if (orient2d(node.prev.point, node.prev.prev.point, node.prev.prev.prev.point) === Orientation.CW) {
        // Concave
        fillLeftConcaveEdgeEvent(tcx, edge, node.prev);
    } else {
        // Convex
        // Next above or below edge?
        if (orient2d(edge.q, node.prev.prev.point, edge.p) === Orientation.CW) {
            // Below
            fillLeftConvexEdgeEvent(tcx, edge, node.prev);
        } else {
            // Above
            /* jshint noempty:false */
        }
    }
}

function fillLeftConcaveEdgeEvent(tcx, edge, node) {
    fill(tcx, node.prev);
    if (node.prev.point !== edge.p) {
        // Next above or below edge?
        if (orient2d(edge.q, node.prev.point, edge.p) === Orientation.CW) {
            // Below
            if (orient2d(node.point, node.prev.point, node.prev.prev.point) === Orientation.CW) {
                // Next is concave
                fillLeftConcaveEdgeEvent(tcx, edge, node);
            } else {
                // Next is convex
                /* jshint noempty:false */
            }
        }
    }
}

function flipEdgeEvent(tcx, ep, eq, t, p) {
    var ot = t.neighborAcross(p);
    if (!ot) {
        // If we want to integrate the fillEdgeEvent do it here
        // With current implementation we should never get here
        throw new Error('poly2tri [BUG:FIXME] FLIP failed due to missing triangle!');
    }
    var op = ot.oppositePoint(t, p);

    // Additional check from Java version (see issue #88)
    if (t.getConstrainedEdgeAcross(p)) {
        var index = t.index(p);
        throw new PointError("poly2tri Intersecting Constraints",
                [p, op, t.getPoint((index + 1) % 3), t.getPoint((index + 2) % 3)]);
    }

    if (inScanArea(p, t.pointCCW(p), t.pointCW(p), op)) {
        // Lets rotate shared edge one vertex CW
        rotateTrianglePair(t, p, ot, op);
        tcx.mapTriangleToNodes(t);
        tcx.mapTriangleToNodes(ot);

        // XXX: in the original C++ code for the next 2 lines, we are
        // comparing point values (and not pointers). In this JavaScript
        // code, we are comparing point references (pointers). This works
        // because we can't have 2 different points with the same values.
        // But to be really equivalent, we should use "Point.equals" here.
        if (p === eq && op === ep) {
            if (eq === tcx.edge_event.constrained_edge.q && ep === tcx.edge_event.constrained_edge.p) {
                t.markConstrainedEdgeByPoints(ep, eq);
                ot.markConstrainedEdgeByPoints(ep, eq);
                legalize(tcx, t);
                legalize(tcx, ot);
            } else {
                // XXX: I think one of the triangles should be legalized here?
                /* jshint noempty:false */
            }
        } else {
            var o = orient2d(eq, op, ep);
            t = nextFlipTriangle(tcx, o, t, ot, p, op);
            flipEdgeEvent(tcx, ep, eq, t, p);
        }
    } else {
        var newP = nextFlipPoint(ep, eq, ot, op);
        flipScanEdgeEvent(tcx, ep, eq, t, ot, newP);
        edgeEventByPoints(tcx, ep, eq, t, p);
    }
}

/**
 * After a flip we have two triangles and know that only one will still be
 * intersecting the edge. So decide which to contiune with and legalize the other
 *
 * @param tcx
 * @param o - should be the result of an orient2d( eq, op, ep )
 * @param t - triangle 1
 * @param ot - triangle 2
 * @param p - a point shared by both triangles
 * @param op - another point shared by both triangles
 * @return returns the triangle still intersecting the edge
 */
function nextFlipTriangle(tcx, o, t, ot, p, op) {
    var edge_index;
    if (o === Orientation.CCW) {
        // ot is not crossing edge after flip
        edge_index = ot.edgeIndex(p, op);
        ot.delaunay_edge[edge_index] = true;
        legalize(tcx, ot);
        ot.clearDelunayEdges();
        return t;
    }

    // t is not crossing edge after flip
    edge_index = t.edgeIndex(p, op);

    t.delaunay_edge[edge_index] = true;
    legalize(tcx, t);
    t.clearDelunayEdges();
    return ot;
}

/**
 * When we need to traverse from one triangle to the next we need
 * the point in current triangle that is the opposite point to the next
 * triangle.
 */
function nextFlipPoint(ep, eq, ot, op) {
    var o2d = orient2d(eq, op, ep);
    if (o2d === Orientation.CW) {
        // Right
        return ot.pointCCW(op);
    } else if (o2d === Orientation.CCW) {
        // Left
        return ot.pointCW(op);
    } else {
        throw new PointError("poly2tri [Unsupported] nextFlipPoint: opposing point on constrained edge!", [eq, op, ep]);
    }
}

/**
 * Scan part of the FlipScan algorithm<br>
 * When a triangle pair isn't flippable we will scan for the next
 * point that is inside the flip triangle scan area. When found
 * we generate a new flipEdgeEvent
 *
 * @param tcx
 * @param ep - last point on the edge we are traversing
 * @param eq - first point on the edge we are traversing
 * @param flipTriangle - the current triangle sharing the point eq with edge
 * @param t
 * @param p
 */
function flipScanEdgeEvent(tcx, ep, eq, flip_triangle, t, p) {
    var ot = t.neighborAcross(p);
    if (!ot) {
        // If we want to integrate the fillEdgeEvent do it here
        // With current implementation we should never get here
        throw new Error('poly2tri [BUG:FIXME] FLIP failed due to missing triangle');
    }
    var op = ot.oppositePoint(t, p);

    if (inScanArea(eq, flip_triangle.pointCCW(eq), flip_triangle.pointCW(eq), op)) {
        // flip with new edge op.eq
        flipEdgeEvent(tcx, eq, op, ot, op);
        // TODO: Actually I just figured out that it should be possible to
        //       improve this by getting the next ot and op before the the above
        //       flip and continue the flipScanEdgeEvent here
        // set new ot and op here and loop back to inScanArea test
        // also need to set a new flip_triangle first
        // Turns out at first glance that this is somewhat complicated
        // so it will have to wait.
    } else {
        var newP = nextFlipPoint(ep, eq, ot, op);
        flipScanEdgeEvent(tcx, ep, eq, flip_triangle, ot, newP);
    }
}


// ----------------------------------------------------------------------Exports

exports.triangulate = triangulate;

},{"./advancingfront":98,"./pointerror":100,"./triangle":104,"./utils":105}],103:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:6 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var PointError = require('./pointerror');
var Point = require('./point');
var Triangle = require('./triangle');
var sweep = require('./sweep');
var AdvancingFront = require('./advancingfront');
var Node = AdvancingFront.Node;


// ------------------------------------------------------------------------utils

/* 
 * Initial triangle factor, seed triangle will extend 30% of
 * PointSet width to both left and right.
 */
var kAlpha = 0.3;


// -------------------------------------------------------------------------Edge
/**
 * Represents a simple polygon's edge
 * @param {Point} p1
 * @param {Point} p2
 */
var Edge = function(p1, p2) {
    this.p = p1;
    this.q = p2;

    if (p1.y > p2.y) {
        this.q = p1;
        this.p = p2;
    } else if (p1.y === p2.y) {
        if (p1.x > p2.x) {
            this.q = p1;
            this.p = p2;
        } else if (p1.x === p2.x) {
            throw new PointError('poly2tri Invalid Edge constructor: repeated points!', [p1]);
        }
    }

    if (!this.q._p2t_edge_list) {
        this.q._p2t_edge_list = [];
    }
    this.q._p2t_edge_list.push(this);
};


// ------------------------------------------------------------------------Basin
var Basin = function() {
    this.left_node = null; // Node
    this.bottom_node = null; // Node
    this.right_node = null; // Node
    this.width = 0.0; // number
    this.left_highest = false;
};

Basin.prototype.clear = function() {
    this.left_node = null;
    this.bottom_node = null;
    this.right_node = null;
    this.width = 0.0;
    this.left_highest = false;
};

// --------------------------------------------------------------------EdgeEvent
var EdgeEvent = function() {
    this.constrained_edge = null; // Edge
    this.right = false;
};

// ----------------------------------------------------SweepContext (public API)
/**
 * Constructor for the triangulation context.
 * It accepts a simple polyline (with non repeating points), 
 * which defines the constrained edges.
 * Possible options are:
 *    cloneArrays:  if true, do a shallow copy of the Array parameters 
 *                  (contour, holes). Points inside arrays are never copied.
 *                  Default is false : keep a reference to the array arguments,
 *                  who will be modified in place.
 * @param {Array} contour  array of "Point like" objects with {x,y} (duck typing)
 * @param {Object} options  constructor options
 */
var SweepContext = function(contour, options) {
    options = options || {};
    this.triangles_ = [];
    this.map_ = [];
    this.points_ = (options.cloneArrays ? contour.slice(0) : contour);
    this.edge_list = [];

    // Bounding box of all points. Computed at the start of the triangulation, 
    // it is stored in case it is needed by the caller.
    this.pmin_ = this.pmax_ = null;

    // Advancing front
    this.front_ = null; // AdvancingFront
    // head point used with advancing front
    this.head_ = null; // Point
    // tail point used with advancing front
    this.tail_ = null; // Point

    this.af_head_ = null; // Node
    this.af_middle_ = null; // Node
    this.af_tail_ = null; // Node

    this.basin = new Basin();
    this.edge_event = new EdgeEvent();

    this.initEdges(this.points_);
};


/**
 * Add a hole to the constraints
 * @param {Array} polyline  array of "Point like" objects with {x,y} (duck typing)
 */
SweepContext.prototype.addHole = function(polyline) {
    this.initEdges(polyline);
    var i, len = polyline.length;
    for (i = 0; i < len; i++) {
        this.points_.push(polyline[i]);
    }
    return this; // for chaining
};
// Backward compatibility
SweepContext.prototype.AddHole = SweepContext.prototype.addHole;


/**
 * Add a Steiner point to the constraints
 * @param {Point} point     any "Point like" object with {x,y} (duck typing)
 */
SweepContext.prototype.addPoint = function(point) {
    this.points_.push(point);
    return this; // for chaining
};
// Backward compatibility
SweepContext.prototype.AddPoint = SweepContext.prototype.addPoint;


/**
 * Add several Steiner points to the constraints
 * @param {array<Point>} points     array of "Point like" object with {x,y} 
 */
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.addPoints = function(points) {
    this.points_ = this.points_.concat(points);
    return this; // for chaining
};


/**
 * Triangulate the polygon with holes and Steiner points.
 * Do this AFTER you've added the polyline, holes, and Steiner points
 */
// Shortcut method for sweep.triangulate(SweepContext).
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.triangulate = function() {
    sweep.triangulate(this);
    return this; // for chaining
};


/**
 * Get the bounding box of the provided constraints (contour, holes and 
 * Steinter points). Warning : these values are not available if the triangulation 
 * has not been done yet.
 * @returns {Object} object with 'min' and 'max' Point
 */
// Method added in the JavaScript version (was not present in the c++ version)
SweepContext.prototype.getBoundingBox = function() {
    return {min: this.pmin_, max: this.pmax_};
};

/**
 * Get result of triangulation
 * @returns {array<Triangle>}   array of triangles
 */
SweepContext.prototype.getTriangles = function() {
    return this.triangles_;
};
// Backward compatibility
SweepContext.prototype.GetTriangles = SweepContext.prototype.getTriangles;


// ---------------------------------------------------SweepContext (private API)

SweepContext.prototype.front = function() {
    return this.front_;
};

SweepContext.prototype.pointCount = function() {
    return this.points_.length;
};

SweepContext.prototype.head = function() {
    return this.head_;
};

SweepContext.prototype.setHead = function(p1) {
    this.head_ = p1;
};

SweepContext.prototype.tail = function() {
    return this.tail_;
};

SweepContext.prototype.setTail = function(p1) {
    this.tail_ = p1;
};

SweepContext.prototype.getMap = function() {
    return this.map_;
};

SweepContext.prototype.initTriangulation = function() {
    var xmax = this.points_[0].x;
    var xmin = this.points_[0].x;
    var ymax = this.points_[0].y;
    var ymin = this.points_[0].y;

    // Calculate bounds
    var i, len = this.points_.length;
    for (i = 1; i < len; i++) {
        var p = this.points_[i];
        /* jshint expr:true */
        (p.x > xmax) && (xmax = p.x);
        (p.x < xmin) && (xmin = p.x);
        (p.y > ymax) && (ymax = p.y);
        (p.y < ymin) && (ymin = p.y);
    }
    this.pmin_ = new Point(xmin, ymin);
    this.pmax_ = new Point(xmax, ymax);

    var dx = kAlpha * (xmax - xmin);
    var dy = kAlpha * (ymax - ymin);
    this.head_ = new Point(xmax + dx, ymin - dy);
    this.tail_ = new Point(xmin - dx, ymin - dy);

    // Sort points along y-axis
    this.points_.sort(Point.compare);
};

SweepContext.prototype.initEdges = function(polyline) {
    var i, len = polyline.length;
    for (i = 0; i < len; ++i) {
        this.edge_list.push(new Edge(polyline[i], polyline[(i + 1) % len]));
    }
};

SweepContext.prototype.getPoint = function(index) {
    return this.points_[index];
};

SweepContext.prototype.addToMap = function(triangle) {
    this.map_.push(triangle);
};

SweepContext.prototype.locateNode = function(point) {
    return this.front_.locateNode(point.x);
};

SweepContext.prototype.createAdvancingFront = function() {
    var head;
    var middle;
    var tail;
    // Initial triangle
    var triangle = new Triangle(this.points_[0], this.tail_, this.head_);

    this.map_.push(triangle);

    head = new Node(triangle.getPoint(1), triangle);
    middle = new Node(triangle.getPoint(0), triangle);
    tail = new Node(triangle.getPoint(2));

    this.front_ = new AdvancingFront(head, tail);

    head.next = middle;
    middle.next = tail;
    middle.prev = head;
    tail.prev = middle;
};

SweepContext.prototype.removeNode = function(node) {
    // do nothing
    /* jshint unused:false */
};

SweepContext.prototype.mapTriangleToNodes = function(t) {
    for (var i = 0; i < 3; ++i) {
        if (!t.getNeighbor(i)) {
            var n = this.front_.locatePoint(t.pointCW(t.getPoint(i)));
            if (n) {
                n.triangle = t;
            }
        }
    }
};

SweepContext.prototype.removeFromMap = function(triangle) {
    var i, map = this.map_, len = map.length;
    for (i = 0; i < len; i++) {
        if (map[i] === triangle) {
            map.splice(i, 1);
            break;
        }
    }
};

/**
 * Do a depth first traversal to collect triangles
 * @param {Triangle} triangle start
 */
SweepContext.prototype.meshClean = function(triangle) {
    // New implementation avoids recursive calls and use a loop instead.
    // Cf. issues # 57, 65 and 69.
    var triangles = [triangle], t, i;
    /* jshint boss:true */
    while (t = triangles.pop()) {
        if (!t.isInterior()) {
            t.setInterior(true);
            this.triangles_.push(t);
            for (i = 0; i < 3; i++) {
                if (!t.constrained_edge[i]) {
                    triangles.push(t.getNeighbor(i));
                }
            }
        }
    }
};

// ----------------------------------------------------------------------Exports

module.exports = SweepContext;

},{"./advancingfront":98,"./point":99,"./pointerror":100,"./sweep":102,"./triangle":104}],104:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 *
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint maxcomplexity:10 */

"use strict";


/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var xy = require("./xy");


// ---------------------------------------------------------------------Triangle
/**
 * Triangle class.<br>
 * Triangle-based data structures are known to have better performance than
 * quad-edge structures.
 * See: J. Shewchuk, "Triangle: Engineering a 2D Quality Mesh Generator and
 * Delaunay Triangulator", "Triangulations in CGAL"
 * 
 * @param   a,b,c   any "Point like" objects with {x,y} (duck typing)
 */
var Triangle = function(a, b, c) {
    // Triangle points
    this.points_ = [a, b, c];
    // Neighbor list
    this.neighbors_ = [null, null, null];
    // Has this triangle been marked as an interior triangle?
    this.interior_ = false;
    // Flags to determine if an edge is a Constrained edge
    this.constrained_edge = [false, false, false];
    // Flags to determine if an edge is a Delauney edge
    this.delaunay_edge = [false, false, false];
};

/**
 * For pretty printing ex. <i>"[(5;42)(10;20)(21;30)]"</i>)
 */
var p2s = xy.toString;
Triangle.prototype.toString = function() {
    return ("[" + p2s(this.points_[0]) + p2s(this.points_[1]) + p2s(this.points_[2]) + "]");
};

Triangle.prototype.getPoint = function(index) {
    return this.points_[index];
};
// for backward compatibility
Triangle.prototype.GetPoint = Triangle.prototype.getPoint;

// Method added in the JavaScript version (was not present in the c++ version)
Triangle.prototype.getPoints = function() {
    return this.points_;
};

Triangle.prototype.getNeighbor = function(index) {
    return this.neighbors_[index];
};

/**
 * Test if this Triangle contains the Point object given as parameters as its
 * vertices. Only point references are compared, not values.
 * @return <code>True</code> if the Point object is of the Triangle's vertices,
 *         <code>false</code> otherwise.
 */
Triangle.prototype.containsPoint = function(point) {
    var points = this.points_;
    // Here we are comparing point references, not values
    return (point === points[0] || point === points[1] || point === points[2]);
};

/**
 * Test if this Triangle contains the Edge object given as parameter as its
 * bounding edges. Only point references are compared, not values.
 * @return <code>True</code> if the Edge object is of the Triangle's bounding
 *         edges, <code>false</code> otherwise.
 */
Triangle.prototype.containsEdge = function(edge) {
    return this.containsPoint(edge.p) && this.containsPoint(edge.q);
};
Triangle.prototype.containsPoints = function(p1, p2) {
    return this.containsPoint(p1) && this.containsPoint(p2);
};


Triangle.prototype.isInterior = function() {
    return this.interior_;
};
Triangle.prototype.setInterior = function(interior) {
    this.interior_ = interior;
    return this;
};

/**
 * Update neighbor pointers.
 * @param {Point} p1 Point object.
 * @param {Point} p2 Point object.
 * @param {Triangle} t Triangle object.
 */
Triangle.prototype.markNeighborPointers = function(p1, p2, t) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if ((p1 === points[2] && p2 === points[1]) || (p1 === points[1] && p2 === points[2])) {
        this.neighbors_[0] = t;
    } else if ((p1 === points[0] && p2 === points[2]) || (p1 === points[2] && p2 === points[0])) {
        this.neighbors_[1] = t;
    } else if ((p1 === points[0] && p2 === points[1]) || (p1 === points[1] && p2 === points[0])) {
        this.neighbors_[2] = t;
    } else {
        throw new Error('poly2tri Invalid Triangle.markNeighborPointers() call');
    }
};

/**
 * Exhaustive search to update neighbor pointers
 * @param {Triangle} t
 */
Triangle.prototype.markNeighbor = function(t) {
    var points = this.points_;
    if (t.containsPoints(points[1], points[2])) {
        this.neighbors_[0] = t;
        t.markNeighborPointers(points[1], points[2], this);
    } else if (t.containsPoints(points[0], points[2])) {
        this.neighbors_[1] = t;
        t.markNeighborPointers(points[0], points[2], this);
    } else if (t.containsPoints(points[0], points[1])) {
        this.neighbors_[2] = t;
        t.markNeighborPointers(points[0], points[1], this);
    }
};


Triangle.prototype.clearNeigbors = function() {
    this.neighbors_[0] = null;
    this.neighbors_[1] = null;
    this.neighbors_[2] = null;
};

Triangle.prototype.clearDelunayEdges = function() {
    this.delaunay_edge[0] = false;
    this.delaunay_edge[1] = false;
    this.delaunay_edge[2] = false;
};

/**
 * Returns the point clockwise to the given point.
 */
Triangle.prototype.pointCW = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return points[2];
    } else if (p === points[1]) {
        return points[0];
    } else if (p === points[2]) {
        return points[1];
    } else {
        return null;
    }
};

/**
 * Returns the point counter-clockwise to the given point.
 */
Triangle.prototype.pointCCW = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return points[1];
    } else if (p === points[1]) {
        return points[2];
    } else if (p === points[2]) {
        return points[0];
    } else {
        return null;
    }
};

/**
 * Returns the neighbor clockwise to given point.
 */
Triangle.prototype.neighborCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[1];
    } else if (p === this.points_[1]) {
        return this.neighbors_[2];
    } else {
        return this.neighbors_[0];
    }
};

/**
 * Returns the neighbor counter-clockwise to given point.
 */
Triangle.prototype.neighborCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[2];
    } else if (p === this.points_[1]) {
        return this.neighbors_[0];
    } else {
        return this.neighbors_[1];
    }
};

Triangle.prototype.getConstrainedEdgeCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[1];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[2];
    } else {
        return this.constrained_edge[0];
    }
};

Triangle.prototype.getConstrainedEdgeCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[2];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[0];
    } else {
        return this.constrained_edge[1];
    }
};

// Additional check from Java version (see issue #88)
Triangle.prototype.getConstrainedEdgeAcross = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.constrained_edge[0];
    } else if (p === this.points_[1]) {
        return this.constrained_edge[1];
    } else {
        return this.constrained_edge[2];
    }
};

Triangle.prototype.setConstrainedEdgeCW = function(p, ce) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.constrained_edge[1] = ce;
    } else if (p === this.points_[1]) {
        this.constrained_edge[2] = ce;
    } else {
        this.constrained_edge[0] = ce;
    }
};

Triangle.prototype.setConstrainedEdgeCCW = function(p, ce) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.constrained_edge[2] = ce;
    } else if (p === this.points_[1]) {
        this.constrained_edge[0] = ce;
    } else {
        this.constrained_edge[1] = ce;
    }
};

Triangle.prototype.getDelaunayEdgeCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.delaunay_edge[1];
    } else if (p === this.points_[1]) {
        return this.delaunay_edge[2];
    } else {
        return this.delaunay_edge[0];
    }
};

Triangle.prototype.getDelaunayEdgeCCW = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.delaunay_edge[2];
    } else if (p === this.points_[1]) {
        return this.delaunay_edge[0];
    } else {
        return this.delaunay_edge[1];
    }
};

Triangle.prototype.setDelaunayEdgeCW = function(p, e) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.delaunay_edge[1] = e;
    } else if (p === this.points_[1]) {
        this.delaunay_edge[2] = e;
    } else {
        this.delaunay_edge[0] = e;
    }
};

Triangle.prototype.setDelaunayEdgeCCW = function(p, e) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        this.delaunay_edge[2] = e;
    } else if (p === this.points_[1]) {
        this.delaunay_edge[0] = e;
    } else {
        this.delaunay_edge[1] = e;
    }
};

/**
 * The neighbor across to given point.
 */
Triangle.prototype.neighborAcross = function(p) {
    // Here we are comparing point references, not values
    if (p === this.points_[0]) {
        return this.neighbors_[0];
    } else if (p === this.points_[1]) {
        return this.neighbors_[1];
    } else {
        return this.neighbors_[2];
    }
};

Triangle.prototype.oppositePoint = function(t, p) {
    var cw = t.pointCW(p);
    return this.pointCW(cw);
};

/**
 * Legalize triangle by rotating clockwise around oPoint
 * @param {Point} opoint
 * @param {Point} npoint
 */
Triangle.prototype.legalize = function(opoint, npoint) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (opoint === points[0]) {
        points[1] = points[0];
        points[0] = points[2];
        points[2] = npoint;
    } else if (opoint === points[1]) {
        points[2] = points[1];
        points[1] = points[0];
        points[0] = npoint;
    } else if (opoint === points[2]) {
        points[0] = points[2];
        points[2] = points[1];
        points[1] = npoint;
    } else {
        throw new Error('poly2tri Invalid Triangle.legalize() call');
    }
};

/**
 * Returns the index of a point in the triangle. 
 * The point *must* be a reference to one of the triangle's vertices.
 * @param {Point} p Point object
 * @returns {Number} index 0, 1 or 2
 */
Triangle.prototype.index = function(p) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p === points[0]) {
        return 0;
    } else if (p === points[1]) {
        return 1;
    } else if (p === points[2]) {
        return 2;
    } else {
        throw new Error('poly2tri Invalid Triangle.index() call');
    }
};

Triangle.prototype.edgeIndex = function(p1, p2) {
    var points = this.points_;
    // Here we are comparing point references, not values
    if (p1 === points[0]) {
        if (p2 === points[1]) {
            return 2;
        } else if (p2 === points[2]) {
            return 1;
        }
    } else if (p1 === points[1]) {
        if (p2 === points[2]) {
            return 0;
        } else if (p2 === points[0]) {
            return 2;
        }
    } else if (p1 === points[2]) {
        if (p2 === points[0]) {
            return 1;
        } else if (p2 === points[1]) {
            return 0;
        }
    }
    return -1;
};

/**
 * Mark an edge of this triangle as constrained.<br>
 * This method takes either 1 parameter (an edge index or an Edge instance) or
 * 2 parameters (two Point instances defining the edge of the triangle).
 */
Triangle.prototype.markConstrainedEdgeByIndex = function(index) {
    this.constrained_edge[index] = true;
};
Triangle.prototype.markConstrainedEdgeByEdge = function(edge) {
    this.markConstrainedEdgeByPoints(edge.p, edge.q);
};
Triangle.prototype.markConstrainedEdgeByPoints = function(p, q) {
    var points = this.points_;
    // Here we are comparing point references, not values        
    if ((q === points[0] && p === points[1]) || (q === points[1] && p === points[0])) {
        this.constrained_edge[2] = true;
    } else if ((q === points[0] && p === points[2]) || (q === points[2] && p === points[0])) {
        this.constrained_edge[1] = true;
    } else if ((q === points[1] && p === points[2]) || (q === points[2] && p === points[1])) {
        this.constrained_edge[0] = true;
    }
};


// ---------------------------------------------------------Exports (public API)

module.exports = Triangle;

},{"./xy":106}],105:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/*
 * Note
 * ====
 * the structure of this JavaScript version of poly2tri intentionally follows
 * as closely as possible the structure of the reference C++ version, to make it 
 * easier to keep the 2 versions in sync.
 */

var EPSILON = 1e-12;

var Orientation = {
    "CW": 1,
    "CCW": -1,
    "COLLINEAR": 0
};

/**
 * Forumla to calculate signed area<br>
 * Positive if CCW<br>
 * Negative if CW<br>
 * 0 if collinear<br>
 * <pre>
 * A[P1,P2,P3]  =  (x1*y2 - y1*x2) + (x2*y3 - y2*x3) + (x3*y1 - y3*x1)
 *              =  (x1-x3)*(y2-y3) - (y1-y3)*(x2-x3)
 * </pre>
 * 
 * @param   pa,pb,pc   any "Point like" objects with {x,y} (duck typing)
 */
function orient2d(pa, pb, pc) {
    var detleft = (pa.x - pc.x) * (pb.y - pc.y);
    var detright = (pa.y - pc.y) * (pb.x - pc.x);
    var val = detleft - detright;
    if (val > -(EPSILON) && val < (EPSILON)) {
        return Orientation.COLLINEAR;
    } else if (val > 0) {
        return Orientation.CCW;
    } else {
        return Orientation.CW;
    }
}

/**
 *  
 * @param   pa,pb,pc,pd   any "Point like" objects with {x,y} (duck typing)
 */
function inScanArea(pa, pb, pc, pd) {
    var oadb = (pa.x - pb.x) * (pd.y - pb.y) - (pd.x - pb.x) * (pa.y - pb.y);
    if (oadb >= -EPSILON) {
        return false;
    }

    var oadc = (pa.x - pc.x) * (pd.y - pc.y) - (pd.x - pc.x) * (pa.y - pc.y);
    if (oadc <= EPSILON) {
        return false;
    }
    return true;
}


// ----------------------------------------------------------------------Exports

module.exports = {
    EPSILON: EPSILON,
    Orientation: Orientation,
    orient2d: orient2d,
    inScanArea: inScanArea
};

},{}],106:[function(require,module,exports){
/*
 * Poly2Tri Copyright (c) 2009-2013, Poly2Tri Contributors
 * http://code.google.com/p/poly2tri/
 * 
 * poly2tri.js (JavaScript port) (c) 2009-2013, Poly2Tri Contributors
 * https://github.com/r3mi/poly2tri.js
 * 
 * All rights reserved.
 * 
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

"use strict";

/*
 * The following functions operate on "Point" or any "Point like" object 
 * with {x,y} (duck typing).
 */


/**
 * Point pretty printing ex. <i>"(5;42)"</i>)
 * @param   p   any "Point like" object with {x,y} 
 * @returns {String}
 */
function toStringBase(p) {
    return ("(" + p.x + ";" + p.y + ")");
}
function toString(p) {
    // Try a custom toString first, and fallback to own implementation if none
    var s = p.toString();
    return (s === '[object Object]' ? toStringBase(p) : s);
}

/**
 * Compare two points component-wise. Ordered by y axis first, then x axis.
 * @param   a,b   any "Point like" objects with {x,y} 
 * @return <code>&lt; 0</code> if <code>a &lt; b</code>, 
 *         <code>&gt; 0</code> if <code>a &gt; b</code>, 
 *         <code>0</code> otherwise.
 */
function compare(a, b) {
    if (a.y === b.y) {
        return a.x - b.x;
    } else {
        return a.y - b.y;
    }
}

/**
 * Test two Point objects for equality.
 * @param   a,b   any "Point like" objects with {x,y} 
 * @return <code>True</code> if <code>a == b</code>, <code>false</code> otherwise.
 */
function equals(a, b) {
    return a.x === b.x && a.y === b.y;
}


module.exports = {
    toString: toString,
    toStringBase: toStringBase,
    compare: compare,
    equals: equals
};

},{}],107:[function(require,module,exports){
"use strict"

module.exports = triangulateLoop

var poly2tri = require("poly2tri")

//poly2tri uses "cute" x/y accessors for point members
function PointWrapper(x, y, idx) {
  this.x = x
  this.y = y
  this.idx = idx
}

function triangulatePolyline(loops, positions, perturb) {
  //Converts a loop into poly2tri format
  function convertLoop(loop) {
    return loop.map(function(v) {
      var p = positions[v]
      return new PointWrapper(
        p[0] + (0.5-Math.random())*perturb*(1.0+Math.abs(p[0])), 
        p[1] + (0.5-Math.random())*perturb*(1.0+Math.abs(p[1])), 
        v)
    })
  }

  //Find outermost loop
  var numLoops = loops.length
  var outerLoop = 0
  var outerPoint = positions[loops[0][0]]
  for(var i=0; i<numLoops; ++i) {
    var loop = loops[i]
    var n = loop.length
    for(var j=0; j<n; ++j) {
      var p = positions[loop[j]]
      var d = p[1] - outerPoint[1]
      if(d === 0) {
        d = p[0] - outerPoint[0]
      }
      if(d < 0) {
        outerPoint = p
        outerLoop = i
      }
    }
  }

  //Pass geometry to poly2tri
  var ctx = new poly2tri.SweepContext(convertLoop(loops[outerLoop]))
  for(var i=0; i<numLoops; ++i) {
    if(i === outerLoop) {
      continue
    }
    ctx.addHole(convertLoop(loops[i]))
  }

  //Triangulate
  ctx.triangulate()
  var triangles = ctx.getTriangles()

  //Unbox triangles from poly2tri format to list of indices
  return triangles.map(function(tri) {
    return [
      tri.getPoint(0).idx,
      tri.getPoint(1).idx,
      tri.getPoint(2).idx
    ]
  })
}

//poly2tri is non robust, so we run it in a loop
//If it fails, then we perturb the vertices by increasing amounts
//until it works.  (Stupid)
function triangulateLoop(loops, positions) {
  var p = 0.0
  for(var i=0; i<10; ++i) {
    try {
      return triangulatePolyline(loops, positions, p)
    }catch(e) {
    }
    p = (p+1e-8)*2
  }
  return []
}
},{"poly2tri":101}],108:[function(require,module,exports){
"use strict"

module.exports = axesProperties

var glm         = require("gl-matrix")
var getPlanes   = require("extract-frustum-planes")
var splitPoly   = require("split-polygon")
var cubeParams  = require("./lib/cube.js")
var mat4        = glm.mat4
var vec4        = glm.vec4

var identity    = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ])

var mvp         = new Float32Array(16)

function AxesRange3D(lo, hi, pixelsPerDataUnit) {
  this.lo = lo
  this.hi = hi
  this.pixelsPerDataUnit = pixelsPerDataUnit
}

var SCRATCH_P = [0,0,0,1]
var SCRATCH_Q = [0,0,0,1]

function gradient(result, M, v, width, height) {
  for(var i=0; i<3; ++i) {
    var p = SCRATCH_P
    var q = SCRATCH_Q
    for(var j=0; j<3; ++j) {
      q[j] = p[j] = v[j]
    }
    q[3] = p[3] = 1

    q[i] += 1
    vec4.transformMat4(q, q, M)
    if(q[3] < 0) {
      result[i] = Infinity
    }
    
    p[i] -= 1
    vec4.transformMat4(p, p, M)
    if(p[3] < 0) {
      result[i] = Infinity
    }
    
    var dx = (p[0]/p[3] - q[0]/q[3]) * width
    var dy = (p[1]/p[3] - q[1]/q[3]) * height

    result[i] = 0.25 * Math.sqrt(dx*dx + dy*dy)
  }
  return result
}

var RANGES = [
  new AxesRange3D(Infinity, -Infinity, Infinity),
  new AxesRange3D(Infinity, -Infinity, Infinity),
  new AxesRange3D(Infinity, -Infinity, Infinity)
]

var SCRATCH_X = [0,0,0]

function axesProperties(axes, camera, width, height, params) {
  var model       = camera.model || identity
  var view        = camera.view || identity
  var projection  = camera.projection || identity
  var bounds      = axes.bounds
  var params      = params || cubeParams(model, view, projection, bounds)
  var axis        = params.axis
  var edges       = params.edges

  mat4.mul(mvp, view, model)
  mat4.mul(mvp, projection, mvp)
  
  //Calculate the following properties for each axis:
  //
  // * lo - start of visible range for each axis in tick coordinates
  // * hi - end of visible range for each axis in tick coordinates
  // * ticksPerPixel - pixel density of tick marks for the axis
  //
  var ranges = RANGES
  for(var i=0; i<3; ++i) {
    ranges[i].lo = Infinity
    ranges[i].hi = -Infinity
    ranges[i].pixelsPerDataUnit = Infinity
  }
  
  //Compute frustum planes, intersect with box
  var frustum = getPlanes(mat4.transpose(mvp, mvp))
  mat4.transpose(mvp, mvp)

  //Loop over vertices of viewable box
  for(var d=0; d<3; ++d) {
    var u = (d+1)%3
    var v = (d+2)%3
    var x = SCRATCH_X
i_loop:
    for(var i=0; i<2; ++i) {
      var poly = []

      if((axis[d] < 0) === !!i) {
        continue
      }

      x[d] = bounds[i][d]
      for(var j=0; j<2; ++j) {
        x[u] = bounds[j^i][u]
        for(var k=0; k<2; ++k) {
          x[v] = bounds[k^j^i][v]
          poly.push(x.slice())
        }
      }
      for(var j=0; j<frustum.length; ++j) {
        if(poly.length === 0) {
          continue i_loop
        }
        poly = splitPoly.positive(poly, frustum[j])
      }

      //Loop over vertices of polygon to find extremal points
      for(var j=0; j<poly.length; ++j) {
        var v = poly[j]
        var grad = gradient(SCRATCH_X, mvp, v, width, height)
        for(var k=0; k<3; ++k) {
          ranges[k].lo = Math.min(ranges[k].lo, v[k])
          ranges[k].hi = Math.max(ranges[k].hi, v[k])
          if(k !== d) {
            ranges[k].pixelsPerDataUnit = Math.min(ranges[k].pixelsPerDataUnit, Math.abs(grad[k]))
          }
        }
      }
    }
  }

  return ranges
}
},{"./lib/cube.js":23,"extract-frustum-planes":29,"gl-matrix":39,"split-polygon":52}],109:[function(require,module,exports){
'use strict'

var webglew = require('webglew')
var createTexture = require('gl-texture2d')

module.exports = createFBO

var colorAttachmentArrays = null
var FRAMEBUFFER_UNSUPPORTED
var FRAMEBUFFER_INCOMPLETE_ATTACHMENT
var FRAMEBUFFER_INCOMPLETE_DIMENSIONS
var FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT

function saveFBOState(gl) {
  var fbo = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  var rbo = gl.getParameter(gl.RENDERBUFFER_BINDING)
  var tex = gl.getParameter(gl.TEXTURE_BINDING_2D)
  return [fbo, rbo, tex]
}

function restoreFBOState(gl, data) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, data[0])
  gl.bindRenderbuffer(gl.RENDERBUFFER, data[1])
  gl.bindTexture(gl.TEXTURE_2D, data[2])
}

function lazyInitColorAttachments(gl, ext) {
  var maxColorAttachments = gl.getParameter(ext.MAX_COLOR_ATTACHMENTS_WEBGL)
  colorAttachmentArrays = new Array(maxColorAttachments + 1)
  for(var i=0; i<=maxColorAttachments; ++i) {
    var x = new Array(maxColorAttachments)
    for(var j=0; j<i; ++j) {
      x[j] = gl.COLOR_ATTACHMENT0 + j
    }
    for(var j=i; j<maxColorAttachments; ++j) {
      x[j] = gl.NONE
    }
    colorAttachmentArrays[i] = x
  }
}

//Throw an appropriate error
function throwFBOError(status) {
  switch(status){
    case FRAMEBUFFER_UNSUPPORTED:
      throw new Error('gl-fbo: Framebuffer unsupported')
    case FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
      throw new Error('gl-fbo: Framebuffer incomplete attachment')
    case FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
      throw new Error('gl-fbo: Framebuffer incomplete dimensions')
    case FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
      throw new Error('gl-fbo: Framebuffer incomplete missing attachment')
    default:
      throw new Error('gl-fbo: Framebuffer failed for unspecified reason')
  }
}

//Initialize a texture object
function initTexture(gl, width, height, type, format, attachment) {
  if(!type) {
    return null
  }
  var result = createTexture(gl, width, height, format, type)
  result.magFilter = gl.NEAREST
  result.minFilter = gl.NEAREST
  result.mipSamples = 1
  result.bind()
  gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, result.handle, 0)
  return result
}

//Initialize a render buffer object
function initRenderBuffer(gl, width, height, component, attachment) {
  var result = gl.createRenderbuffer()
  gl.bindRenderbuffer(gl.RENDERBUFFER, result)
  gl.renderbufferStorage(gl.RENDERBUFFER, component, width, height)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, result)
  return result
}

//Rebuild the frame buffer
function rebuildFBO(fbo) {

  //Save FBO state
  var state = saveFBOState(fbo.gl)

  var gl = fbo.gl
  var handle = fbo.handle = gl.createFramebuffer()
  var width = fbo._shape[0]
  var height = fbo._shape[1]
  var numColors = fbo.color.length
  var ext = fbo._ext
  var useStencil = fbo._useStencil
  var useDepth = fbo._useDepth
  var colorType = fbo._colorType
  var extensions = webglew(gl)

  //Bind the fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, handle)
  
  //Allocate color buffers
  for(var i=0; i<numColors; ++i) {
    fbo.color[i] = initTexture(gl, width, height, colorType, gl.RGBA, gl.COLOR_ATTACHMENT0 + i)
  }
  if(numColors === 0) {
    fbo._color_rb = initRenderBuffer(gl, width, height, gl.RGBA4, gl.COLOR_ATTACHMENT0)
    if(ext) {
      ext.drawBuffersWEBGL(colorAttachmentArrays[0])
    }
  } else if(numColors > 1) {
    ext.drawBuffersWEBGL(colorAttachmentArrays[numColor])
  }

  //Allocate depth/stencil buffers
  if(extensions.WEBGL_depth_texture) {
    if(useStencil) {
      fbo.depth = initTexture(gl, width, height,
                          extensions.WEBGL_depth_texture.UNSIGNED_INT_24_8_WEBGL,
                          gl.DEPTH_STENCIL,
                          gl.DEPTH_STENCIL_ATTACHMENT)
    } else if(useDepth) {
      fbo.depth = initTexture(gl, width, height,
                          gl.UNSIGNED_SHORT,
                          gl.DEPTH_COMPONENT,
                          gl.DEPTH_ATTACHMENT)
    }
  } else {
    if(useDepth && useStencil) {
      fbo._depth_rb = initRenderBuffer(gl, width, height, gl.DEPTH_STENCIL, gl.DEPTH_STENCIL_ATTACHMENT)
    } else if(useDepth) {
      fbo._depth_rb = initRenderBuffer(gl, width, height, gl.DEPTH_COMPONENT16, gl.DEPTH_ATTACHMENT)
    } else if(useStencil) {
      fbo._depth_rb = initRenderBuffer(gl, width, height, gl.STENCIL_INDEX, gl.STENCIL_ATTACHMENT)
    }
  }

  //Check frame buffer state
  var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if(status !== gl.FRAMEBUFFER_COMPLETE) {

    //Release all partially allocated resources
    fbo._destroyed = true

    //Release all resources
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fbo.handle)
    fbo.handle = null
    if(fbo.depth) {
      fbo.depth.dispose()
      fbo.depth = null
    }
    if(fbo._depth_rb) {
      gl.deleteRenderbuffer(fbo._depth_rb)
      fbo._depth_rb = null
    }
    for(var i=0; i<fbo.color.length; ++i) {
      fbo.color[i].dispose()
      fbo.color[i] = null
    }
    if(fbo._color_rb) {
      gl.deleteRenderbuffer(fbo._color_rb)
      fbo._color_rb = null
    }

    restoreFBOState(gl, state)

    //Throw the frame buffer error
    throwFBOError(status)
  }

  //Everything ok, let's get on with life
  restoreFBOState(gl, state)
}

function Framebuffer(gl, width, height, colorType, numColors, useDepth, useStencil, ext) {
  var extensions = webglew(gl)

  //Handle and set properties
  this.gl = gl
  this._shape = [width|0, height|0]
  this._destroyed = false
  this._ext = ext

  //Allocate buffers
  this.color = new Array(numColors)
  for(var i=0; i<numColors; ++i) {
    this.color[i] = null
  }
  this._color_rb = null
  this.depth = null
  this._depth_rb = null

  //Save depth and stencil flags
  this._colorType = colorType
  this._useDepth = useDepth
  this._useStencil = useStencil
  
  //Shape vector for resizing
  var parent = this
  var shapeVector = [width|0, height|0]
  Object.defineProperties(shapeVector, {
    0: {
      get: function() {
        return parent._shape[0]
      },
      set: function(w) {
        return parent.width = w
      }
    },
    1: {
      get: function() {
        return parent._shape[1]
      },
      set: function(h) {
        return parent.height = h
      }
    }
  })
  this._shapeVector = shapeVector

  //Initialize all attachments
  rebuildFBO(this)
}

var proto = Framebuffer.prototype

function reshapeFBO(fbo, w, h) {
  //If fbo is invalid, just skip this
  if(fbo._destroyed) {
    throw new Error('gl-fbo: Can\'t resize destroyed FBO')
  }

  //Don't resize if no change in shape
  if( (fbo._shape[0] === w) &&
      (fbo._shape[1] === h) ) {
    return
  }

  var gl = fbo.gl
  
  //Check parameter ranges
  var maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
  if( w < 0 || w > maxFBOSize || 
      h < 0 || h > maxFBOSize) {
    throw new Error('gl-fbo: Can\'t resize FBO, invalid dimensions')
  }

  //Update shape
  fbo._shape[0] = w
  fbo._shape[1] = h

  //Save framebuffer state
  var state = saveFBOState(gl)

  //Resize framebuffer attachments
  for(var i=0; i<fbo.color.length; ++i) {
    fbo.color[i].shape = fbo._shape
  }
  if(fbo._color_rb) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, fbo._color_rb)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA4, fbo._shape[0], fbo._shape[1])
  }
  if(fbo.depth) {
    fbo.depth.shape = fbo._shape
  }
  if(fbo._depth_rb) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, fbo._depth_rb)
    if(fbo._useDepth && fbo._useStencil) {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, fbo._shape[0], fbo._shape[1])
    } else if(fbo._useDepth) {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, fbo._shape[0], fbo._shape[1])
    } else if(fbo._useStencil) {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX, fbo._shape[0], fbo._shape[1])
    }
  }

  //Check FBO status after resize, if something broke then die in a fire
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.handle)
  var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  if(status !== gl.FRAMEBUFFER_COMPLETE) {
    fbo.dispose()
    restoreFBOState(gl, state)
    throwFBOError(status)
  }
  
  //Restore framebuffer state
  restoreFBOState(gl, state)
}

Object.defineProperties(proto, {
  'shape': {
    get: function() {
      if(this._destroyed) {
        return [0,0]
      }
      return this._shapeVector
    },
    set: function(x) {
      if(!Array.isArray(x)) {
        x = [x|0, x|0]
      }
      if(x.length !== 2) {
        throw new Error('gl-fbo: Shape vector must be length 2')
      }

      var w = x[0]|0
      var h = x[1]|0
      reshapeFBO(this, w, h)

      return [w, h]
    },
    enumerable: false
  },
  'width': {
    get: function() {
      if(this._destroyed) {
        return 0
      }
      return this._shape[0]
    },
    set: function(w) {
      w = w|0
      reshapeFBO(this, w, this._shape[1])
      return w
    },
    enumerable: false
  },
  'height': {
    get: function() {
      if(this._destroyed) {
        return 0
      }
      return this._shape[1]
    },
    set: function(h) {
      h = h|0
      reshapeFBO(this, this._shape[0], h)
      return h
    },
    enumerable: false
  }
})

proto.bind = function() {
  if(this._destroyed) {
    return
  }
  var gl = this.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle)
  gl.viewport(0, 0, this._shape[0], this._shape[1])
}

proto.dispose = function() {
  if(this._destroyed) {
    return
  }
  this._destroyed = true
  var gl = this.gl
  gl.deleteFramebuffer(this.handle)
  this.handle = null
  if(this.depth) {
    this.depth.dispose()
    this.depth = null
  }
  if(this._depth_rb) {
    gl.deleteRenderbuffer(this._depth_rb)
    this._depth_rb = null
  }
  for(var i=0; i<this.color.length; ++i) {
    this.color[i].dispose()
    this.color[i] = null
  }
  if(this._color_rb) {
    gl.deleteRenderbuffer(this._color_rb)
    this._color_rb = null
  }
}

function createFBO(gl, width, height, options) {

  //Update frame buffer error code values
  if(!FRAMEBUFFER_UNSUPPORTED) {
    FRAMEBUFFER_UNSUPPORTED = gl.FRAMEBUFFER_UNSUPPORTED
    FRAMEBUFFER_INCOMPLETE_ATTACHMENT = gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
    FRAMEBUFFER_INCOMPLETE_DIMENSIONS = gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS
    FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT = gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT
  }

  var extensions = webglew(gl)
  
  //Lazily initialize color attachment arrays
  if(!colorAttachmentArrays && extensions.WEBGL_draw_buffers) {
    lazyInitColorAttachments(gl, extensions.WEBGL_draw_buffers)
  }

  //Special case: Can accept an array as argument
  if(Array.isArray(width)) {
    options = height
    height = width[1]|0
    width = width[0]|0
  }
  
  if(typeof width !== 'number') {
    throw new Error('gl-fbo: Missing shape parameter')
  }

  //Validate width/height properties
  var maxFBOSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
  if(width < 0 || width > maxFBOSize || height < 0 || height > maxFBOSize) {
    throw new Error('gl-fbo: Parameters are too large for FBO')
  }

  //Handle each option type
  options = options || {}

  //Figure out number of color buffers to use
  var numColors = 1
  if('color' in options) {
    numColors = Math.max(options.color|0, 0)
    if(numColors < 0) {
      throw new Error('gl-fbo: Must specify a nonnegative number of colors')
    }
    if(numColors > 1) {
      //Check if multiple render targets supported
      var mrtext = extensions.WEBGL_draw_buffers
      if(!mrtext) {
        throw new Error('gl-fbo: Multiple draw buffer extension not supported')
      } else if(numColors > gl.getParameter(mrtext.MAX_COLOR_ATTACHMENTS_WEBGL)) {
        throw new Error('gl-fbo: Context does not support ' + numColors + ' draw buffers')
      }
    }
  }

  //Determine whether to use floating point textures
  var colorType = gl.UNSIGNED_BYTE
  if(options.float && numColors > 0) {
    if(!extensions.OES_texture_float) {
      throw new Error('gl-fbo: Context does not support floating point textures')
    }
    colorType = gl.FLOAT
  } else if(options.preferFloat && numColors > 0) {
    if(extensions.OES_texture_float) {
      colorType = gl.FLOAT
    }
  }

  //Check if we should use depth buffer
  var useDepth = true
  if('depth' in options) {
    useDepth = !!options.depth
  }

  //Check if we should use a stencil buffer
  var useStencil = false
  if('stencil' in options) {
    useStencil = !!options.stencil
  }

  return new Framebuffer(
    gl, 
    width, 
    height, 
    colorType, 
    numColors, 
    useDepth, 
    useStencil, 
    extensions.WEBGL_draw_buffers)
}
},{"gl-texture2d":118,"webglew":120}],110:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"cwise-compiler":111,"dup":3}],111:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":113,"dup":4}],112:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":114}],113:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":112,"dup":6}],114:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],115:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],116:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],117:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":115,"buffer":250,"dup":10}],118:[function(require,module,exports){
'use strict'

var ndarray = require('ndarray')
var ops     = require('ndarray-ops')
var pool    = require('typedarray-pool')
var webglew = require('webglew')

module.exports = createTexture2D

var linearTypes = null
var filterTypes = null
var wrapTypes   = null

function lazyInitLinearTypes(gl) {
  linearTypes = [
    gl.LINEAR,
    gl.NEAREST_MIPMAP_LINEAR,
    gl.LINEAR_MIPMAP_NEAREST,
    gl.LINEAR_MIPMAP_NEAREST
  ]
  filterTypes = [
    gl.NEAREST,
    gl.LINEAR,
    gl.NEAREST_MIPMAP_NEAREST,
    gl.NEAREST_MIPMAP_LINEAR,
    gl.LINEAR_MIPMAP_NEAREST,
    gl.LINEAR_MIPMAP_LINEAR
  ]
  wrapTypes = [
    gl.REPEAT,
    gl.CLAMP_TO_EDGE,
    gl.MIRRORED_REPEAT
  ]
}

var convertFloatToUint8 = function(out, inp) {
  ops.muls(out, inp, 255.0)
}

function reshapeTexture(tex, w, h) {
  var gl = tex.gl
  var maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  if(w < 0 || w > maxSize || h < 0 || h > maxSize) {
    throw new Error('gl-texture2d: Invalid texture size')
  }
  tex._shape = [w, h]
  tex.bind()
  gl.texImage2D(gl.TEXTURE_2D, 0, tex.format, w, h, 0, tex.format, tex.type, null)
  tex._mipLevels = [0]
  return tex
}

function Texture2D(gl, handle, width, height, format, type) {
  this.gl = gl
  this.handle = handle
  this.format = format
  this.type = type
  this._shape = [width, height]
  this._mipLevels = [0]
  this._magFilter = gl.NEAREST
  this._minFilter = gl.NEAREST
  this._wrapS = gl.CLAMP_TO_EDGE
  this._wrapT = gl.CLAMP_TO_EDGE
  this._anisoSamples = 1

  var parent = this
  var wrapVector = [this._wrapS, this._wrapT]
  Object.defineProperties(wrapVector, [
    {
      get: function() {
        return parent._wrapS
      },
      set: function(v) {
        return parent.wrapS = v
      }
    },
    {
      get: function() {
        return parent._wrapT
      },
      set: function(v) {
        return parent.wrapT = v
      }
    }
  ])
  this._wrapVector = wrapVector

  var shapeVector = [this._shape[0], this._shape[1]]
  Object.defineProperties(shapeVector, [
    {
      get: function() {
        return parent._shape[0]
      },
      set: function(v) {
        return parent.width = v
      }
    },
    {
      get: function() {
        return parent._shape[1]
      },
      set: function(v) {
        return parent.height = v
      }
    }
  ])
  this._shapeVector = shapeVector
}

var proto = Texture2D.prototype

Object.defineProperties(proto, {
  minFilter: {
    get: function() {
      return this._minFilter
    },
    set: function(v) {
      this.bind()
      var gl = this.gl
      if(this.type === gl.FLOAT && linearTypes.indexOf(v) >= 0) {
        if(!webglew(gl).texture_float_linear) {
          v = gl.NEAREST
        }
      }
      if(filterTypes.indexOf(v) < 0) {
        throw new Error('gl-texture2d: Unknown filter mode ' + v)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, v)
      return this._minFilter = v
    }
  },
  magFilter: {
    get: function() {
      return this._magFilter
    },
    set: function(v) {
      this.bind()
      var gl = this.gl
      if(this.type === gl.FLOAT && linearTypes.indexOf(v) >= 0) {
        if(!webglew(gl).texture_float_linear) {
          v = gl.NEAREST
        }
      }
      if(filterTypes.indexOf(v) < 0) {
        throw new Error('gl-texture2d: Unknown filter mode ' + v)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, v)
      return this._magFilter = v
    }
  },
  mipSamples: {
    get: function() {
      return this._anisoSamples
    },
    set: function(i) {
      var psamples = this._anisoSamples
      this._anisoSamples = Math.max(i, 1)|0
      if(psamples !== this._anisoSamples) {
        var ext = webglew(this.gl).EXT_texture_filter_anisotropic
        if(ext) {
          this.gl.texParameterf(this.gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, this._anisoSamples)
        }
      }
      return this._anisoSamples
    }
  },
  wrapS: {
    get: function() {
      return this._wrapS
    },
    set: function(v) {
      this.bind()
      if(wrapTypes.indexOf(v) < 0) {
        throw new Error('gl-texture2d: Unknown wrap mode ' + v)
      }
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, v)
      return this._wrapS = v
    }
  },
  wrapT: {
    get: function() {
      return this._wrapT
    },
    set: function(v) {
      this.bind()
      if(wrapTypes.indexOf(v) < 0) {
        throw new Error('gl-texture2d: Unknown wrap mode ' + v)
      }
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, v)
      return this._wrapT = v
    }
  },
  wrap: {
    get: function() {
      return this._wrapVector
    },
    set: function(v) {
      if(!Array.isArray(v)) {
        v = [v,v]
      }
      if(v.length !== 2) {
        throw new Error('gl-texture2d: Must specify wrap mode for rows and columns')
      }
      for(var i=0; i<2; ++i) {
        if(wrapTypes.indexOf(v[i]) < 0) {
          throw new Error('gl-texture2d: Unknown wrap mode ' + v)
        }
      }
      this._wrapS = v[0]
      this._wrapT = v[1]

      var gl = this.gl
      this.bind()
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this._wrapS)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this._wrapT)

      return v
    }
  },
  shape: {
    get: function() {
      return this._shapeVector
    }, 
    set: function(x) {
      if(!Array.isArray(x)) {
        x = [x|0,x|0]
      } else {
        if(x.length !== 2) {
          throw new Error('gl-texture2d: Invalid texture shape')
        }
      }
      reshapeTexture(this, x[0]|0, x[1]|0)
      return [x[0]|0, x[1]|0]
    }
  },
  width: {
    get: function() {
      return this._shape[0]
    },
    set: function(w) {
      w = w|0
      reshapeTexture(this, w, this._shape[1])
      return w
    }
  },
  height: {
    get: function() {
      return this._shape[1]
    },
    set: function(h) {
      h = h|0
      reshapeTexture(this, this._shape[0], h)
      return h
    }
  }
})

proto.bind = function(unit) {
  var gl = this.gl
  if(unit !== undefined) {
    gl.activeTexture(gl.TEXTURE0 + (unit|0))
  }
  gl.bindTexture(gl.TEXTURE_2D, this.handle)
  if(unit !== undefined) {
    return (unit|0)
  }
  return gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0
}

proto.dispose = function() {
  this.gl.deleteTexture(this.handle)
}

proto.generateMipmap = function() {
  this.bind()
  this.gl.generateMipmap(this.gl.TEXTURE_2D)
  
  //Update mip levels
  var l = Math.min(this._shape[0], this._shape[1])
  for(var i=0; l>0; ++i, l>>>=1) {
    if(this._mipLevels.indexOf(i) < 0) {
      this._mipLevels.push(i)
    }
  }
}

proto.setPixels = function(data, x_off, y_off, mip_level) {
  var gl = this.gl
  this.bind()
  if(Array.isArray(x_off)) {
    mip_level = y_off
    y_off = x_off[1]|0
    x_off = x_off[0]|0
  } else {
    x_off = x_off || 0
    y_off = y_off || 0
  }
  mip_level = mip_level || 0
  if(data instanceof HTMLCanvasElement ||
     data instanceof ImageData ||
     data instanceof HTMLImageElement ||
     data instanceof HTMLVideoElement) {
    var needsMip = this._mipLevels.indexOf(mip_level) < 0
    if(needsMip) {
      gl.texImage2D(gl.TEXTURE_2D, 0, this.format, this.format, this.type, data)
      this._mipLevels.push(mip_level)
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, mip_level, x_off, y_off, this.format, this.type, data)
    }
  } else if(data.shape && data.stride && data.data) {
    if(data.shape.length < 2 ||
       x_off + data.shape[1] > this._shape[1]>>>mip_level ||
       y_off + data.shape[0] > this._shape[0]>>>mip_level ||
       x_off < 0 ||
       y_off < 0) {
      throw new Error('gl-texture2d: Texture dimensions are out of bounds')
    }
    texSubImageArray(gl, x_off, y_off, mip_level, this.format, this.type, this._mipLevels, data)
  } else {
    throw new Error('gl-texture2d: Unsupported data type')
  }
}


function isPacked(shape, stride) {
  if(shape.length === 3) {
    return  (stride[2] === 1) && 
            (stride[1] === shape[0]*shape[2]) &&
            (stride[0] === shape[2])
  }
  return  (stride[0] === 1) && 
          (stride[1] === shape[0])
}

function texSubImageArray(gl, x_off, y_off, mip_level, cformat, ctype, mipLevels, array) {
  var dtype = array.dtype
  var shape = array.shape.slice()
  if(shape.length < 2 || shape.length > 3) {
    throw new Error('gl-texture2d: Invalid ndarray, must be 2d or 3d')
  }
  var type = 0, format = 0
  var packed = isPacked(shape, array.stride.slice())
  if(dtype === 'float32') {
    type = gl.FLOAT
  } else if(dtype === 'float64') {
    type = gl.FLOAT
    packed = false
    dtype = 'float32'
  } else if(dtype === 'uint8') {
    type = gl.UNSIGNED_BYTE
  } else {
    type = gl.UNSIGNED_BYTE
    packed = false
    dtype = 'uint8'
  }
  var channels = 1
  if(shape.length === 2) {
    format = gl.LUMINANCE
    shape = [shape[0], shape[1], 1]
    array = ndarray(array.data, shape, [array.stride[0], array.stride[1], 1], array.offset)
  } else if(shape.length === 3) {
    if(shape[2] === 1) {
      format = gl.ALPHA
    } else if(shape[2] === 2) {
      format = gl.LUMINANCE_ALPHA
    } else if(shape[2] === 3) {
      format = gl.RGB
    } else if(shape[2] === 4) {
      format = gl.RGBA
    } else {
      throw new Error('gl-texture2d: Invalid shape for pixel coords')
    }
    channels = shape[2]
  } else {
    throw new Error('gl-texture2d: Invalid shape for texture')
  }
  //For 1-channel textures allow conversion between formats
  if((format  === gl.LUMINANCE || format  === gl.ALPHA) &&
     (cformat === gl.LUMINANCE || cformat === gl.ALPHA)) {
    format = cformat
  }
  if(format !== cformat) {
    throw new Error('gl-texture2d: Incompatible texture format for setPixels')
  }
  var size = array.size
  var needsMip = mipLevels.indexOf(mip_level) < 0
  if(needsMip) {
    mipLevels.push(mip_level)
  }
  if(type === ctype && packed) {
    //Array data types are compatible, can directly copy into texture
    if(array.offset === 0 && array.data.length === size) {
      if(needsMip) {
        gl.texImage2D(gl.TEXTURE_2D, mip_level, cformat, shape[0], shape[1], 0, cformat, ctype, array.data)
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, mip_level, x_off, y_off, shape[0], shape[1], cformat, ctype, array.data)
      }
    } else {
      if(needsMip) {
        gl.texImage2D(gl.TEXTURE_2D, mip_level, cformat, shape[0], shape[1], 0, cformat, ctype, array.data.subarray(array.offset, array.offset+size))
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, mip_level, x_off, y_off, shape[0], shape[1], cformat, ctype, array.data.subarray(array.offset, array.offset+size))
      }
    }
  } else {
    //Need to do type conversion to pack data into buffer
    var pack_buffer
    if(ctype === gl.FLOAT) {
      pack_buffer = pool.mallocFloat32(size)
    } else {
      pack_buffer = pool.mallocUint8(size)
    }
    var pack_view = ndarray(pack_buffer, shape, [shape[2], shape[2]*shape[0], 1])
    if(type === gl.FLOAT && ctype === gl.UNSIGNED_BYTE) {
      convertFloatToUint8(pack_view, array)
    } else {
      ops.assign(pack_view, array)
    }
    if(needsMip) {
      gl.texImage2D(gl.TEXTURE_2D, mip_level, cformat, shape[0], shape[1], 0, cformat, ctype, pack_buffer.subarray(0, size))
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, mip_level, x_off, y_off, shape[0], shape[1], cformat, ctype, pack_buffer.subarray(0, size))
    }
    if(ctype === gl.FLOAT) {
      pool.freeFloat32(pack_buffer)
    } else {
      pool.freeUint8(pack_buffer)
    }
  }
}

function initTexture(gl) {
  var tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

function createTextureShape(gl, width, height, format, type) {
  var maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  if(width < 0 || width > maxTextureSize || height < 0 || height  > maxTextureSize) {
    throw new Error('gl-texture2d: Invalid texture shape')
  }
  if(type === gl.FLOAT && !webglew(gl).texture_float) {
    throw new Error('gl-texture2d: Floating point textures not supported on this platform')
  }
  var tex = initTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, null)
  return new Texture2D(gl, tex, width, height, format, type)
}

function createTextureDOM(gl, element, format, type) {
  var tex = initTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, format, format, type, element)
  return new Texture2D(gl, tex, element.width|0, element.height|0, format, type)
}

//Creates a texture from an ndarray
function createTextureArray(gl, array) {
  var dtype = array.dtype
  var shape = array.shape.slice()
  var maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  if(shape[0] < 0 || shape[0] > maxSize || shape[1] < 0 || shape[1] > maxSize) {
    throw new Error('gl-texture2d: Invalid texture size')
  }
  var packed = isPacked(shape, array.stride.slice())
  var type = 0
  if(dtype === 'float32') {
    type = gl.FLOAT
  } else if(dtype === 'float64') {
    type = gl.FLOAT
    packed = false
    dtype = 'float32'
  } else if(dtype === 'uint8') {
    type = gl.UNSIGNED_BYTE
  } else {
    type = gl.UNSIGNED_BYTE
    packed = false
    dtype = 'uint8'
  }
  var format = 0
  if(shape.length === 2) {
    format = gl.LUMINANCE
    shape = [shape[0], shape[1], 1]
    array = ndarray(array.data, shape, [array.stride[0], array.stride[1], 1], array.offset)
  } else if(shape.length === 3) {
    if(shape[2] === 1) {
      format = gl.ALPHA
    } else if(shape[2] === 2) {
      format = gl.LUMINANCE_ALPHA
    } else if(shape[2] === 3) {
      format = gl.RGB
    } else if(shape[2] === 4) {
      format = gl.RGBA
    } else {
      throw new Error('gl-texture2d: Invalid shape for pixel coords')
    }
  } else {
    throw new Error('gl-texture2d: Invalid shape for texture')
  }
  if(type === gl.FLOAT && !webglew(gl).texture_float) {
    type = gl.UNSIGNED_BYTE
    packed = false
  }
  var buffer, buf_store
  var size = array.size
  if(!packed) {
    var stride = [shape[2], shape[2]*shape[0], 1]
    buf_store = pool.malloc(size, dtype)
    var buf_array = ndarray(buf_store, shape, stride, 0)
    if((dtype === 'float32' || dtype === 'float64') && type === gl.UNSIGNED_BYTE) {
      convertFloatToUint8(buf_array, array)
    } else {
      ops.assign(buf_array, array)
    }
    buffer = buf_store.subarray(0, size)
  } else if (array.offset === 0 && array.data.length === size) {
    buffer = array.data
  } else {
    buffer = array.data.subarray(array.offset, array.offset + size)
  }
  var tex = initTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, format, shape[0], shape[1], 0, format, type, buffer)
  if(!packed) {
    pool.free(buf_store)
  }
  return new Texture2D(gl, tex, shape[0], shape[1], format, type)
}

function createTexture2D(gl) {
  if(arguments.length <= 1) {
    throw new Error('gl-texture2d: Missing arguments for texture2d constructor')
  }
  if(!linearTypes) {
    lazyInitLinearTypes(gl)
  }
  if(typeof arguments[1] === 'number') {
    return createTextureShape(gl, arguments[1], arguments[2], arguments[3]||gl.RGBA, arguments[4]||gl.UNSIGNED_BYTE)
  }
  if(Array.isArray(arguments[1])) {
    return createTextureShape(gl, arguments[1][0]|0, arguments[1][1]|0, arguments[2]||gl.RGBA, arguments[3]||gl.UNSIGNED_BYTE)
  }
  if(typeof arguments[1] === 'object') {
    var obj = arguments[1]
    if(obj instanceof HTMLCanvasElement ||
       obj instanceof HTMLImageElement ||
       obj instanceof HTMLVideoElement ||
       obj instanceof ImageData) {
      return createTextureDOM(gl, obj, arguments[2]||gl.RGBA, arguments[3]||gl.UNSIGNED_BYTE)
    } else if(obj.shape && obj.data && obj.stride) {
      return createTextureArray(gl, obj)
    }
  }
  throw new Error('gl-texture2d: Invalid arguments for texture2d constructor')
}

},{"ndarray":247,"ndarray-ops":110,"typedarray-pool":117,"webglew":120}],119:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],120:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":119}],121:[function(require,module,exports){
module.exports = fromQuat;

/**
 * Creates a matrix from a quaternion rotation.
 *
 * @param {mat4} out mat4 receiving operation result
 * @param {quat4} q Rotation quaternion
 * @returns {mat4} out
 */
function fromQuat(out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        yx = y * x2,
        yy = y * y2,
        zx = z * x2,
        zy = z * y2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2;

    out[0] = 1 - yy - zz;
    out[1] = yx + wz;
    out[2] = zx - wy;
    out[3] = 0;

    out[4] = yx - wz;
    out[5] = 1 - xx - zz;
    out[6] = zy + wx;
    out[7] = 0;

    out[8] = zx + wy;
    out[9] = zy - wx;
    out[10] = 1 - xx - yy;
    out[11] = 0;

    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;

    return out;
};
},{}],122:[function(require,module,exports){
module.exports = identity;

/**
 * Set a mat4 to the identity matrix
 *
 * @param {mat4} out the receiving matrix
 * @returns {mat4} out
 */
function identity(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
};
},{}],123:[function(require,module,exports){
module.exports = invert;

/**
 * Inverts a mat4
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the source matrix
 * @returns {mat4} out
 */
function invert(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        // Calculate the determinant
        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

    if (!det) { 
        return null; 
    }
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
};
},{}],124:[function(require,module,exports){
var identity = require('./identity');

module.exports = lookAt;

/**
 * Generates a look-at matrix with the given eye position, focal point, and up axis
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {vec3} eye Position of the viewer
 * @param {vec3} center Point the viewer is looking at
 * @param {vec3} up vec3 pointing up
 * @returns {mat4} out
 */
function lookAt(out, eye, center, up) {
    var x0, x1, x2, y0, y1, y2, z0, z1, z2, len,
        eyex = eye[0],
        eyey = eye[1],
        eyez = eye[2],
        upx = up[0],
        upy = up[1],
        upz = up[2],
        centerx = center[0],
        centery = center[1],
        centerz = center[2];

    if (Math.abs(eyex - centerx) < 0.000001 &&
        Math.abs(eyey - centery) < 0.000001 &&
        Math.abs(eyez - centerz) < 0.000001) {
        return identity(out);
    }

    z0 = eyex - centerx;
    z1 = eyey - centery;
    z2 = eyez - centerz;

    len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    z0 *= len;
    z1 *= len;
    z2 *= len;

    x0 = upy * z2 - upz * z1;
    x1 = upz * z0 - upx * z2;
    x2 = upx * z1 - upy * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
    } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
    }

    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;

    len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
    if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
    } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
    }

    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1;

    return out;
};
},{"./identity":122}],125:[function(require,module,exports){
module.exports = multiply;

/**
 * Multiplies two mat4's
 *
 * @param {mat4} out the receiving matrix
 * @param {mat4} a the first operand
 * @param {mat4} b the second operand
 * @returns {mat4} out
 */
function multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    // Cache only the current line of the second matrix
    var b0  = b[0], b1 = b[1], b2 = b[2], b3 = b[3];  
    out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
    out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
    out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
    out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    return out;
};
},{}],126:[function(require,module,exports){
module.exports = perspective;

/**
 * Generates a perspective projection matrix with the given bounds
 *
 * @param {mat4} out mat4 frustum matrix will be written into
 * @param {number} fovy Vertical field of view in radians
 * @param {number} aspect Aspect ratio. typically viewport width/height
 * @param {number} near Near bound of the frustum
 * @param {number} far Far bound of the frustum
 * @returns {mat4} out
 */
function perspective(out, fovy, aspect, near, far) {
    var f = 1.0 / Math.tan(fovy / 2),
        nf = 1 / (near - far);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = (2 * far * near) * nf;
    out[15] = 0;
    return out;
};
},{}],127:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],128:[function(require,module,exports){
module.exports = require("cwise-compiler")
},{"cwise-compiler":129}],129:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":131,"dup":4}],130:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":132}],131:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":130,"dup":6}],132:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],133:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],134:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":127,"buffer":250,"dup":10}],135:[function(require,module,exports){
'use strict'

module.exports = createSelectBuffer

var createFBO = require('gl-fbo')
var pool      = require('typedarray-pool')
var ndarray   = require('ndarray')

var nextPow2  = require('bit-twiddle').nextPow2

var selectRange = require('cwise/lib/wrapper')({"args":["array",{"offset":[0,0,1],"array":0},{"offset":[0,0,2],"array":0},{"offset":[0,0,3],"array":0},"scalar","scalar","scalar","index"],"pre":{"body":"{this_closestX=-1,this_closestY=-1,this_closestD2=1e8}","args":[],"thisVars":["this_closestD2","this_closestX","this_closestY"],"localVars":[]},"body":{"body":"{if(255>_inline_1_arg0_){var _inline_1_a=_inline_1_arg4_-_inline_1_arg7_[0],_inline_1_f=_inline_1_arg5_-_inline_1_arg7_[1],_inline_1_n=_inline_1_a*_inline_1_a+_inline_1_f*_inline_1_f;_inline_1_n<this_closestD2&&(this_closestD2=_inline_1_n,this_closestX=_inline_1_arg7_[0],this_closestY=_inline_1_arg7_[1])}}","args":[{"name":"_inline_1_arg0_","lvalue":false,"rvalue":true,"count":1},{"name":"_inline_1_arg1_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_1_arg2_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_1_arg3_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_1_arg4_","lvalue":false,"rvalue":true,"count":1},{"name":"_inline_1_arg5_","lvalue":false,"rvalue":true,"count":1},{"name":"_inline_1_arg6_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_1_arg7_","lvalue":false,"rvalue":true,"count":4}],"thisVars":["this_closestD2","this_closestX","this_closestY"],"localVars":["_inline_1_a","_inline_1_f","_inline_1_n"]},"post":{"body":"{_inline_2_arg6_[0]=this_closestX,_inline_2_arg6_[1]=this_closestY,_inline_2_arg6_[2]=this_closestD2}","args":[{"name":"_inline_2_arg0_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg1_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg2_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg3_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg4_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg5_","lvalue":false,"rvalue":false,"count":0},{"name":"_inline_2_arg6_","lvalue":false,"rvalue":true,"count":3}],"thisVars":["this_closestD2","this_closestX","this_closestY"],"localVars":[]},"debug":false,"funcName":"cwise","blockSize":64})

function SelectResult(x, y, id, value, distance) {
  this.coord = [x, y]
  this.id = id
  this.value = value
  this.distance = distance
}

function SelectBuffer(gl, fbo, buffer) {
  this.gl     = gl
  this.fbo    = fbo
  this.buffer = buffer
  this._readTimeout = null
  this._selectResult = new SelectResult(0,0,0,[0,0,0],Infinity)
  this._region = ndarray(this.buffer, [fbo.width, fbo.height, 4], [4, 4*fbo.width, 1], 0)
  var self = this

  this._readCallback = function() {
    fbo.bind()
    gl.readPixels(0,0,fbo.shape[0],fbo.shape[1],gl.RGBA,gl.UNSIGNED_BYTE,self.buffer)
    self._readTimeout = null
  }
}

var proto = SelectBuffer.prototype

Object.defineProperty(proto, 'shape', {
  get: function() {
    return this.fbo.shape.slice()
  },
  set: function(v) {
    this.fbo.shape = v
    var c = this.fbo.shape[0]
    var r = this.fbo.shape[1]
    if(r*c*4 > this.buffer.length) {
      pool.free(this.buffer)
      var buffer = this.buffer = pool.mallocUint8(nextPow2(r*c*4))
      for(var i=0; i<r*c*4; ++i) {
        buffer[i] = 0xff
      }
    }
    return v
  }
})

proto.begin = function() {
  var gl = this.gl
  var shape = this.shape
  
  this.fbo.bind()
  gl.clearColor(1,1,1,1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
}

proto.end = function() {
  var gl = this.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if(!this._readTimeout) {
    clearTimeout(this._readTimeout)
  }
  this._readTimeout = setTimeout(this._readCallback, 1)
}

var QUERY_RESULT = [0,0,0]

proto.query = function(x, y, radius) {
  var w = this.fbo.width
  var h = this.fbo.height

  x = x|0
  y = y|0
  if(typeof radius !== 'number') {
    radius = 1.0
  }

  var x0 = Math.min(x-radius, w)|0
  var x1 = Math.min(Math.max(x + radius, 0), w)|0
  var y0 = Math.min(y-radius, h)|0
  var y1 = Math.min(Math.max(y + radius, 0), h)|0

  var xr = radius
  if(x0 < 0) {
    xr += x0
    x0 = 0
  }

  var yr = radius
  if(y0 < 0) {
    yr += y0
    y0 = 0
  }

  if(x1 <= x0 || y1 <= y0) {
    return null
  }

  var region = this._region
  region.data = this.buffer
  region.shape[0] = (x1-x0)|0
  region.shape[1] = (y1-y0)|0
  region.shape[2] = 4
  region.stride[0] = 4
  region.stride[1] = 4 * w
  region.stride[2] = 1
  region.offset = 4 * (x0 + w * y0)

  selectRange(region, xr, yr, QUERY_RESULT)
  var dx = QUERY_RESULT[0]
  var dy = QUERY_RESULT[1]
  var d2 = QUERY_RESULT[2]
  if(dx < 0 || Math.pow(radius, 2) < d2) {
    return null
  }

  var xc = (x0 + dx)|0
  var yc = (y0 + dy)|0

  var result = this._selectResult
  result.coord[0] = xc
  result.coord[1] = yc
  result.id       = region.get(dx, dy, 0)
  result.value[0] = region.get(dx, dy, 1)
  result.value[1] = region.get(dx, dy, 2)
  result.value[2] = region.get(dx, dy, 3)
  result.distance = Math.sqrt(d2)

  return result
}

proto.dispose = function() {
  this.fbo.dispose()
  pool.free(this.buffer)
}

function createSelectBuffer(gl, shape) {
  var fbo = createFBO(gl, shape)
  var buffer = pool.mallocUint8(shape[0]*shape[1]*4)
  return new SelectBuffer(gl, fbo, buffer)
}
},{"bit-twiddle":127,"cwise/lib/wrapper":128,"gl-fbo":109,"ndarray":247,"typedarray-pool":134}],136:[function(require,module,exports){
'use strict'

var createUniformWrapper   = require('./lib/create-uniforms')
var createAttributeWrapper = require('./lib/create-attributes')
var makeReflect            = require('./lib/reflect')
var shaderCache            = require('./lib/shader-cache')
var runtime                = require('./lib/runtime-reflect')

//Shader object
function Shader(gl) {
  this.gl         = gl

  //Default initialize these to null
  this._vref      = 
  this._fref      = 
  this._relink    =
  this.vertShader =
  this.fragShader =
  this.program    =
  this.attributes =
  this.uniforms   =
  this.types      = null
}

var proto = Shader.prototype

proto.bind = function() {
  if(!this.program) {
    this._relink()
  }
  this.gl.useProgram(this.program)
}

proto.dispose = function() {
  if(this._fref) {
    this._fref.dispose()
  }
  if(this._vref) {
    this._vref.dispose()
  }
  this.attributes =
  this.types      =
  this.vertShader =
  this.fragShader =
  this.program    = 
  this._relink    = 
  this._fref      = 
  this._vref      = null
}

function compareAttributes(a, b) {
  if(a.name < b.name) {
    return -1
  }
  return 1
}

//Update export hook for glslify-live
proto.update = function(
    vertSource
  , fragSource
  , uniforms
  , attributes) {

  //If only one object passed, assume glslify style output
  if(!fragSource || arguments.length === 1) {
    var obj = vertSource
    vertSource = obj.vertex
    fragSource = obj.fragment
    uniforms   = obj.uniforms
    attributes = obj.attributes
  }

  var wrapper = this
  var gl      = wrapper.gl

  //Compile vertex and fragment shaders
  var pvref = wrapper._vref
  wrapper._vref = shaderCache.shader(gl, gl.VERTEX_SHADER, vertSource)
  if(pvref) {
    pvref.dispose()
  }
  wrapper.vertShader = wrapper._vref.shader
  var pfref = this._fref
  wrapper._fref = shaderCache.shader(gl, gl.FRAGMENT_SHADER, fragSource)
  if(pfref) {
    pfref.dispose()
  }
  wrapper.fragShader = wrapper._fref.shader
  
  //If uniforms/attributes is not specified, use RT reflection
  if(!uniforms || !attributes) {

    //Create initial test program
    var testProgram = gl.createProgram()
    gl.attachShader(testProgram, wrapper.fragShader)
    gl.attachShader(testProgram, wrapper.vertShader)
    gl.linkProgram(testProgram)
    if(!gl.getProgramParameter(testProgram, gl.LINK_STATUS)) {
      var errLog = gl.getProgramInfoLog(testProgram)
      console.error('gl-shader: Error linking program:', errLog)
      throw new Error('gl-shader: Error linking program:' + errLog)
    }
    
    //Load data from runtime
    uniforms   = uniforms   || runtime.uniforms(gl, testProgram)
    attributes = attributes || runtime.attributes(gl, testProgram)

    //Release test program
    gl.deleteProgram(testProgram)
  }

  //Sort attributes lexicographically
  // overrides undefined WebGL behavior for attribute locations
  attributes = attributes.slice()
  attributes.sort(compareAttributes)

  //Convert attribute types, read out locations
  var attributeUnpacked  = []
  var attributeNames     = []
  var attributeLocations = []
  for(var i=0; i<attributes.length; ++i) {
    var attr = attributes[i]
    if(attr.type.indexOf('mat') >= 0) {
      var size = attr.type.charAt(attr.type.length-1)|0
      var locVector = new Array(size)
      for(var j=0; j<size; ++j) {
        locVector[j] = attributeLocations.length
        attributeNames.push(attr.name + '[' + j + ']')
        if(typeof attr.location === 'number') {
          attributeLocations.push(attr.location + j)
        } else if(Array.isArray(attr.location) && 
                  attr.location.length === size &&
                  typeof attr.location[j] === 'number') {
          attributeLocations.push(attr.location[j]|0)
        } else {
          attributeLocations.push(-1)
        }
      }
      attributeUnpacked.push({
        name: attr.name,
        type: attr.type,
        locations: locVector
      })
    } else {
      attributeUnpacked.push({
        name: attr.name,
        type: attr.type,
        locations: [ attributeLocations.length ]
      })
      attributeNames.push(attr.name)
      if(typeof attr.location === 'number') {
        attributeLocations.push(attr.location|0)
      } else {
        attributeLocations.push(-1)
      }
    }
  }

  //For all unspecified attributes, assign them lexicographically min attribute
  var curLocation = 0
  for(var i=0; i<attributeLocations.length; ++i) {
    if(attributeLocations[i] < 0) {
      while(attributeLocations.indexOf(curLocation) >= 0) {
        curLocation += 1
      }
      attributeLocations[i] = curLocation
    }
  }

  //Rebuild program and recompute all uniform locations
  var uniformLocations = new Array(uniforms.length)
  function relink() {
    wrapper.program = shaderCache.program(
        gl
      , wrapper._vref
      , wrapper._fref
      , attributeNames
      , attributeLocations)

    for(var i=0; i<uniforms.length; ++i) {
      uniformLocations[i] = gl.getUniformLocation(
          wrapper.program
        , uniforms[i].name)
    }
  }

  //Perform initial linking, reuse program used for reflection
  relink()

  //Save relinking procedure, defer until runtime
  wrapper._relink = relink

  //Generate type info
  wrapper.types = {
    uniforms:   makeReflect(uniforms),
    attributes: makeReflect(attributes)
  }

  //Generate attribute wrappers
  wrapper.attributes = createAttributeWrapper(
      gl
    , wrapper
    , attributeUnpacked
    , attributeLocations)

  //Generate uniform wrappers
  Object.defineProperty(wrapper, 'uniforms', createUniformWrapper(
      gl
    , wrapper
    , uniforms
    , uniformLocations))
}

//Compiles and links a shader program with the given attribute and vertex list
function createShader(
    gl
  , vertSource
  , fragSource
  , uniforms
  , attributes) {

  var shader = new Shader(gl)

  shader.update(
      vertSource
    , fragSource
    , uniforms
    , attributes)

  return shader
}

module.exports = createShader
},{"./lib/create-attributes":137,"./lib/create-uniforms":138,"./lib/reflect":139,"./lib/runtime-reflect":140,"./lib/shader-cache":141}],137:[function(require,module,exports){
'use strict'

module.exports = createAttributeWrapper

function ShaderAttribute(
    gl
  , wrapper
  , index
  , locations
  , dimension
  , constFunc) {
  this._gl        = gl
  this._wrapper   = wrapper
  this._index     = index
  this._locations = locations
  this._dimension = dimension
  this._constFunc = constFunc
}

var proto = ShaderAttribute.prototype

proto.pointer = function setAttribPointer(
    type
  , normalized
  , stride
  , offset) {

  var self      = this
  var gl        = self._gl
  var location  = self._locations[self._index]

  gl.vertexAttribPointer(
      location
    , self._dimension
    , type || gl.FLOAT
    , !!normalized
    , stride || 0
    , offset || 0)
  gl.enableVertexAttribArray(location)
}

proto.set = function(x0, x1, x2, x3) {
  return this._constFunc(this._locations[this._index], x0, x1, x2, x3)
}

Object.defineProperty(proto, 'location', {
  get: function() {
    return this._locations[this._index]
  }
  , set: function(v) {
    if(v !== this._locations[this._index]) {
      this._locations[this._index] = v|0
      this._wrapper.program = null
    }
    return v|0
  }
})

//Adds a vector attribute to obj
function addVectorAttribute(
    gl
  , wrapper
  , index
  , locations
  , dimension
  , obj
  , name) {

  //Construct constant function
  var constFuncArgs = [ 'gl', 'v' ]
  var varNames = []
  for(var i=0; i<dimension; ++i) {
    constFuncArgs.push('x'+i)
    varNames.push('x'+i)
  }
  constFuncArgs.push(
    'if(x0.length===void 0){return gl.vertexAttrib' +
    dimension + 'f(v,' +
    varNames.join() +
    ')}else{return gl.vertexAttrib' +
    dimension +
    'fv(v,x0)}')
  var constFunc = Function.apply(null, constFuncArgs)

  //Create attribute wrapper
  var attr = new ShaderAttribute(
      gl
    , wrapper
    , index
    , locations
    , dimension
    , constFunc)

  //Create accessor
  Object.defineProperty(obj, name, {
    set: function(x) {
      gl.disableVertexAttribArray(locations[index])
      constFunc(gl, locations[index], x)
      return x
    }
    , get: function() {
      return attr
    }
    , enumerable: true
  })
}

function addMatrixAttribute(
    gl
  , wrapper
  , index
  , locations
  , dimension
  , obj
  , name) {

  var parts = new Array(dimension)
  var attrs = new Array(dimension)
  for(var i=0; i<dimension; ++i) {
    addVectorAttribute(
        gl
      , wrapper
      , index[i]
      , locations
      , dimension
      , parts
      , i)
    attrs[i] = parts[i]
  }

  Object.defineProperty(parts, 'location', {
    set: function(v) {
      if(Array.isArray) {
        for(var i=0; i<dimension; ++i) {
          attrs[i].location = v[i]
        }
      } else {
        for(var i=0; i<dimension; ++i) {
          result[i] = attrs[i].location = v + i
        }
      }
      return v
    }
    , get: function() {
      var result = new Array(dimension)
      for(var i=0; i<dimension; ++i) {
        result[i] = locations[index[i]]
      }
      return result
    }
    , enumerable: true
  })

  parts.pointer = function(type, normalized, stride, offset) {
    type       = type || gl.FLOAT
    normalized = !!normalized
    stride     = stride || (dimension * dimension)
    offset     = offset || 0
    for(var i=0; i<dimension; ++i) {
      var location = locations[index[i]]
      gl.vertexAttribPointer(
            location
          , dimension
          , type
          , normalized
          , stride
          , offset + i * dimension)
      gl.enableVertexAttribArray(location)
    }
  }

  var scratch = new Array(dimension)
  var vertexAttrib = gl['vertexAttrib' + dimension + 'fv']

  Object.defineProperty(obj, name, {
    set: function(x) {
      for(var i=0; i<dimension; ++i) {
        var loc = locations[index[i]]
        gl.disableVertexAttribArray(loc)
        if(Array.isArray(x[0])) {
          vertexAttrib.call(gl, loc, x[i])
        } else {
          for(var j=0; j<dimension; ++j) {
            scratch[j] = x[dimension*i + j]
          }
          vertexAttrib.call(gl, loc, scratch)
        }
      }
      return x
    }
    , get: function() {
      return parts
    }
    , enumerable: true
  })
}

//Create shims for attributes
function createAttributeWrapper(
    gl
  , wrapper
  , attributes
  , locations) {

  var obj = {}
  for(var i=0, n=attributes.length; i<n; ++i) {

    var a = attributes[i]
    var name = a.name
    var type = a.type
    var locs = a.locations

    switch(type) {
      case 'bool':
      case 'int':
      case 'float':
        addVectorAttribute(
            gl
          , wrapper
          , locs[0]
          , locations
          , 1
          , obj
          , name)
      break
      
      default:
        if(type.indexOf('vec') >= 0) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type for attribute ' + name + ': ' + type)
          }
          addVectorAttribute(
              gl
            , wrapper
            , locs[0]
            , locations
            , d
            , obj
            , name)
        } else if(type.indexOf('mat') >= 0) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type for attribute ' + name + ': ' + type)
          }
          addMatrixAttribute(
              gl
            , wrapper
            , locs
            , locations
            , d
            , obj
            , name)
        } else {
          throw new Error('gl-shader: Unknown data type for attribute ' + name + ': ' + type)
        }
      break
    }
  }
  return obj
}
},{}],138:[function(require,module,exports){
'use strict'

var coallesceUniforms = require('./reflect')

module.exports = createUniformWrapper

//Binds a function and returns a value
function identity(x) {
  var c = new Function('y', 'return function(){return y}')
  return c(x)
}

function makeVector(length, fill) {
  var result = new Array(length)
  for(var i=0; i<length; ++i) {
    result[i] = fill
  }
  return result
}

//Create shims for uniforms
function createUniformWrapper(gl, wrapper, uniforms, locations) {

  function makeGetter(index) {
    var proc = new Function(
        'gl'
      , 'wrapper'
      , 'locations'
      , 'return function(){return gl.getUniform(wrapper.program,locations[' + index + '])}') 
    return proc(gl, wrapper, locations)
  }

  function makePropSetter(path, index, type) {
    switch(type) {
      case 'bool':
      case 'int':
      case 'sampler2D':
      case 'samplerCube':
        return 'gl.uniform1i(locations[' + index + '],obj' + path + ')'
      case 'float':
        return 'gl.uniform1f(locations[' + index + '],obj' + path + ')'
      default:
        var vidx = type.indexOf('vec')
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type')
          }
          switch(type.charAt(0)) {
            case 'b':
            case 'i':
              return 'gl.uniform' + d + 'iv(locations[' + index + '],obj' + path + ')'
            case 'v':
              return 'gl.uniform' + d + 'fv(locations[' + index + '],obj' + path + ')'
            default:
              throw new Error('gl-shader: Unrecognized data type for vector ' + name + ': ' + type)
          }
        } else if(type.indexOf('mat') === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid uniform dimension type for matrix ' + name + ': ' + type)
          }
          return 'gl.uniformMatrix' + d + 'fv(locations[' + index + '],false,obj' + path + ')'
        } else {
          throw new Error('gl-shader: Unknown uniform data type for ' + name + ': ' + type)
        }
      break
    }
  }

  function enumerateIndices(prefix, type) {
    if(typeof type !== 'object') {
      return [ [prefix, type] ]
    }
    var indices = []
    for(var id in type) {
      var prop = type[id]
      var tprefix = prefix
      if(parseInt(id) + '' === id) {
        tprefix += '[' + id + ']'
      } else {
        tprefix += '.' + id
      }
      if(typeof prop === 'object') {
        indices.push.apply(indices, enumerateIndices(tprefix, prop))
      } else {
        indices.push([tprefix, prop])
      }
    }
    return indices
  }

  function makeSetter(type) {
    var code = [ 'return function updateProperty(obj){' ]
    var indices = enumerateIndices('', type)
    for(var i=0; i<indices.length; ++i) {
      var item = indices[i]
      var path = item[0]
      var idx  = item[1]
      if(locations[idx]) {
        code.push(makePropSetter(path, idx, uniforms[idx].type))
      }
    }
    code.push('return obj}')
    var proc = new Function('gl', 'locations', code.join('\n'))
    return proc(gl, locations)
  }

  function defaultValue(type) {
    switch(type) {
      case 'bool':
        return false
      case 'int':
      case 'sampler2D':
      case 'samplerCube':
        return 0
      case 'float':
        return 0.0
      default:
        var vidx = type.indexOf('vec')
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type')
          }
          if(type.charAt(0) === 'b') {
            return makeVector(d, false)
          }
          return makeVector(d, 0)
        } else if(type.indexOf('mat') === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid uniform dimension type for matrix ' + name + ': ' + type)
          }
          return makeVector(d*d, 0)
        } else {
          throw new Error('gl-shader: Unknown uniform data type for ' + name + ': ' + type)
        }
      break
    }
  }

  function storeProperty(obj, prop, type) {
    if(typeof type === 'object') {
      var child = processObject(type)
      Object.defineProperty(obj, prop, {
        get: identity(child),
        set: makeSetter(type),
        enumerable: true,
        configurable: false
      })
    } else {
      if(locations[type]) {
        Object.defineProperty(obj, prop, {
          get: makeGetter(type),
          set: makeSetter(type),
          enumerable: true,
          configurable: false
        })
      } else {
        obj[prop] = defaultValue(uniforms[type].type)
      }
    }
  }

  function processObject(obj) {
    var result
    if(Array.isArray(obj)) {
      result = new Array(obj.length)
      for(var i=0; i<obj.length; ++i) {
        storeProperty(result, i, obj[i])
      }
    } else {
      result = {}
      for(var id in obj) {
        storeProperty(result, id, obj[id])
      }
    }
    return result
  }

  //Return data
  var coallesced = coallesceUniforms(uniforms, true)
  return {
    get: identity(processObject(coallesced)),
    set: makeSetter(coallesced),
    enumerable: true,
    configurable: true
  }
}

},{"./reflect":139}],139:[function(require,module,exports){
'use strict'

module.exports = makeReflectTypes

//Construct type info for reflection.
//
// This iterates over the flattened list of uniform type values and smashes them into a JSON object.
//
// The leaves of the resulting object are either indices or type strings representing primitive glslify types
function makeReflectTypes(uniforms, useIndex) {
  var obj = {}
  for(var i=0; i<uniforms.length; ++i) {
    var n = uniforms[i].name
    var parts = n.split(".")
    var o = obj
    for(var j=0; j<parts.length; ++j) {
      var x = parts[j].split("[")
      if(x.length > 1) {
        if(!(x[0] in o)) {
          o[x[0]] = []
        }
        o = o[x[0]]
        for(var k=1; k<x.length; ++k) {
          var y = parseInt(x[k])
          if(k<x.length-1 || j<parts.length-1) {
            if(!(y in o)) {
              if(k < x.length-1) {
                o[y] = []
              } else {
                o[y] = {}
              }
            }
            o = o[y]
          } else {
            if(useIndex) {
              o[y] = i
            } else {
              o[y] = uniforms[i].type
            }
          }
        }
      } else if(j < parts.length-1) {
        if(!(x[0] in o)) {
          o[x[0]] = {}
        }
        o = o[x[0]]
      } else {
        if(useIndex) {
          o[x[0]] = i
        } else {
          o[x[0]] = uniforms[i].type
        }
      }
    }
  }
  return obj
}
},{}],140:[function(require,module,exports){
'use strict'

exports.uniforms    = runtimeUniforms
exports.attributes  = runtimeAttributes

var GL_TO_GLSL_TYPES = {
  'FLOAT':       'float',
  'FLOAT_VEC2':  'vec2',
  'FLOAT_VEC3':  'vec3',
  'FLOAT_VEC4':  'vec4',
  'INT':         'int',
  'INT_VEC2':    'ivec2',
  'INT_VEC3':    'ivec3',
  'INT_VEC4':    'ivec4',
  'BOOL':        'bool',
  'BOOL_VEC2':   'bvec2',
  'BOOL_VEC3':   'bvec3',
  'BOOL_VEC4':   'bvec4',
  'FLOAT_MAT2':  'mat2',
  'FLOAT_MAT3':  'mat3',
  'FLOAT_MAT4':  'mat4',
  'SAMPLER_2D':  'sampler2D',
  'SAMPLER_CUBE':'samplerCube'
}

var GL_TABLE = null

function getType(gl, type) {
  if(!GL_TABLE) {
    var typeNames = Object.keys(GL_TO_GLSL_TYPES)
    GL_TABLE = {}
    for(var i=0; i<typeNames.length; ++i) {
      var tn = typeNames[i]
      GL_TABLE[gl[tn]] = GL_TO_GLSL_TYPES[tn]
    }
  }
  return GL_TABLE[type]
}

function runtimeUniforms(gl, program) {
  var numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
  var result = []
  for(var i=0; i<numUniforms; ++i) {
    var info = gl.getActiveUniform(program, i)
    if(info) {
      result.push({
        name: info.name,
        type: getType(gl, info.type)
      })
    }
  }
  return result
}

function runtimeAttributes(gl, program) {
  var numAttributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES)
  var result = []
  for(var i=0; i<numAttributes; ++i) {
    var info = gl.getActiveAttrib(program, i)
    if(info) {
      result.push({
        name: info.name,
        type: getType(gl, info.type)
      })
    }
  }
  return result
}
},{}],141:[function(require,module,exports){
'use strict'

exports.shader   = getShaderReference
exports.program  = createProgram

var weakMap = typeof WeakMap === 'undefined' ? require('weakmap-shim') : WeakMap
var CACHE = new weakMap()

var SHADER_COUNTER = 0

function ShaderReference(id, src, type, shader, programs, count, cache) {
  this.id       = id
  this.src      = src
  this.type     = type
  this.shader   = shader
  this.count    = count
  this.programs = []
  this.cache    = cache
}

ShaderReference.prototype.dispose = function() {
  if(--this.count === 0) {
    var cache    = this.cache
    var gl       = cache.gl
    
    //Remove program references
    var programs = this.programs
    for(var i=0, n=programs.length; i<n; ++i) {
      var p = cache.programs[programs[i]]
      if(p) {
        delete cache.programs[i]
        gl.deleteProgram(p)
      }
    }

    //Remove shader reference
    gl.deleteShader(this.shader)
    delete cache.shaders[(this.type === gl.FRAGMENT_SHADER)|0][this.src]
  }
}

function ContextCache(gl) {
  this.gl       = gl
  this.shaders  = [{}, {}]
  this.programs = {}
}

var proto = ContextCache.prototype

function compileShader(gl, type, src) {
  var shader = gl.createShader(type)
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(shader)
    console.error('gl-shader: Error compiling shader:', errLog)
    throw new Error('gl-shader: Error compiling shader:' + errLog)
  }
  return shader
}

proto.getShaderReference = function(type, src) {
  var gl      = this.gl
  var shaders = this.shaders[(type === gl.FRAGMENT_SHADER)|0]
  var shader  = shaders[src]
  if(!shader) {
    var shaderObj = compileShader(gl, type, src)
    shader = shaders[src] = new ShaderReference(
      SHADER_COUNTER++,
      src,
      type,
      shaderObj,
      [],
      1,
      this)
  } else {
    shader.count += 1
  }
  return shader
}

function linkProgram(gl, vshader, fshader, attribs, locations) {
  var program = gl.createProgram()
  gl.attachShader(program, vshader)
  gl.attachShader(program, fshader)
  for(var i=0; i<attribs.length; ++i) {
    gl.bindAttribLocation(program, locations[i], attribs[i])
  }
  gl.linkProgram(program)
  if(!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var errLog = gl.getProgramInfoLog(program)
    console.error('gl-shader: Error linking program:', errLog)
    throw new Error('gl-shader: Error linking program:' + errLog)
  }
  return program
}

proto.getProgram = function(vref, fref, attribs, locations) {
  var token = [vref.id, fref.id, attribs.join(':'), locations.join(':')].join('@')
  var prog  = this.programs[token]
  if(!prog) {
    this.programs[token] = prog = linkProgram(
      this.gl,
      vref.shader,
      fref.shader,
      attribs,
      locations)
    vref.programs.push(token)
    fref.programs.push(token)
  }
  return prog
}

function getCache(gl) {
  var ctxCache = CACHE.get(gl)
  if(!ctxCache) {
    ctxCache = new ContextCache(gl)
    CACHE.set(gl, ctxCache)
  }
  return ctxCache
}

function getShaderReference(gl, type, src) {
  return getCache(gl).getShaderReference(type, src)
}

function createProgram(gl, vref, fref, attribs, locations) {
  return getCache(gl).getProgram(vref, fref, attribs, locations)
}
},{"weakmap-shim":144}],142:[function(require,module,exports){
var hiddenStore = require('./hidden-store.js');

module.exports = createStore;

function createStore() {
    var key = {};

    return function (obj) {
        if ((typeof obj !== 'object' || obj === null) &&
            typeof obj !== 'function'
        ) {
            throw new Error('Weakmap-shim: Key must be object')
        }

        var store = obj.valueOf(key);
        return store && store.identity === key ?
            store : hiddenStore(obj, key);
    };
}

},{"./hidden-store.js":143}],143:[function(require,module,exports){
module.exports = hiddenStore;

function hiddenStore(obj, key) {
    var store = { identity: key };
    var valueOf = obj.valueOf;

    Object.defineProperty(obj, "valueOf", {
        value: function (value) {
            return value !== key ?
                valueOf.apply(this, arguments) : store;
        },
        writable: true
    });

    return store;
}

},{}],144:[function(require,module,exports){
// Original - @Gozola. 
// https://gist.github.com/Gozala/1269991
// This is a reimplemented version (with a few bug fixes).

var createStore = require('./create-store.js');

module.exports = weakMap;

function weakMap() {
    var privates = createStore();

    return {
        'get': function (key, fallback) {
            var store = privates(key)
            return store.hasOwnProperty('value') ?
                store.value : fallback
        },
        'set': function (key, value) {
            privates(key).value = value;
        },
        'has': function(key) {
            return 'value' in privates(key);
        },
        'delete': function (key) {
            return delete privates(key).value;
        }
    }
}

},{"./create-store.js":142}],145:[function(require,module,exports){
arguments[4][2][0].apply(exports,arguments)
},{"dup":2,"ndarray":247,"ndarray-ops":146,"typedarray-pool":153,"webglew":155}],146:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"cwise-compiler":147,"dup":3}],147:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":149,"dup":4}],148:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":150}],149:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":148,"dup":6}],150:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],151:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],152:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],153:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":151,"buffer":250,"dup":10}],154:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],155:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":154}],156:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"dup":13}],157:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./do-bind.js":156,"dup":14}],158:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"./do-bind.js":156,"dup":15}],159:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],160:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":159}],161:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./lib/vao-emulated.js":157,"./lib/vao-native.js":158,"dup":18,"webglew":160}],162:[function(require,module,exports){
"use strict";
var createBuffer = require("gl-buffer");
var createVAO = require("gl-vao");
var glslify = require("glslify");
module.exports = createSpikes;
var createShader = require("glslify/adapter.js")("\n#define GLSLIFY 1\n\nprecision mediump float;\nattribute vec3 position, color;\nuniform mat4 model, view, projection;\nuniform vec3 coordinates[3];\nuniform vec4 colors[3];\nvarying vec4 fragColor;\nvoid main() {\n  vec3 vertexPosition = mix(coordinates[0], mix(coordinates[2], coordinates[1], 0.5 * (position + 1.0)), abs(position));\n  vec4 worldCoordinate = model * vec4(vertexPosition, 1.0);\n  vec4 viewCoordinate = view * worldCoordinate;\n  vec4 clipCoordinate = projection * viewCoordinate;\n  gl_Position = clipCoordinate;\n  fragColor = color.x * colors[0] + color.y * colors[1] + color.z * colors[2];\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nvarying vec4 fragColor;\nvoid main() {\n  gl_FragColor = fragColor;\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"coordinates[0]","type":"vec3"},{"name":"coordinates[1]","type":"vec3"},{"name":"coordinates[2]","type":"vec3"},{"name":"colors[0]","type":"vec4"},{"name":"colors[1]","type":"vec4"},{"name":"colors[2]","type":"vec4"}], [{"name":"position","type":"vec3"},{"name":"color","type":"vec3"}]);
var identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function AxisSpikes(gl, buffer, vao, shader) {
    this.gl = gl;
    this.buffer = buffer;
    this.vao = vao;
    this.shader = shader;
    this.bounds = [[-1000, -1000, -1000], [1000, 1000, 1000]];
    this.position = [0, 0, 0];
    this.lineWidth = [2, 2, 2];
    this.colors = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];
    this.enabled = [true, true, true];
    this.drawSides = [true, true, true];
    this.axes = null;
}

var proto = AxisSpikes.prototype;
var OUTER_FACE = [0, 0, 0];
var INNER_FACE = [0, 0, 0];

proto.isTransparent = function() {
    return false;
};

proto.drawTransparent = function(camera) {};

proto.draw = function(camera) {
    var gl = this.gl;
    var vao = this.vao;
    var shader = this.shader;
    vao.bind();
    shader.bind();
    var model = camera.model || identity;
    var view = camera.view || identity;
    var projection = camera.projection || identity;
    var axis;

    if (this.axes) {
        axis = this.axes.lastCubeProps.axis;
    }

    var outerFace = OUTER_FACE;
    var innerFace = INNER_FACE;

    for (var i = 0; i < 3; ++i) {
        if (axis && axis[i] < 0) {
            outerFace[i] = this.bounds[0][i];
            innerFace[i] = this.bounds[1][i];
        } else {
            outerFace[i] = this.bounds[1][i];
            innerFace[i] = this.bounds[0][i];
        }
    }

    shader.uniforms.model = model;
    shader.uniforms.view = view;
    shader.uniforms.projection = projection;
    shader.uniforms.coordinates = [this.position, outerFace, innerFace];
    shader.uniforms.colors = this.colors;

    for (var i = 0; i < 3; ++i) {
        gl.lineWidth(this.lineWidth[i]);

        if (this.enabled[i]) {
            vao.draw(gl.LINES, 2, 2 * i);

            if (this.drawSides[i]) {
                vao.draw(gl.LINES, 4, 6 + 4 * i);
            }
        }
    }

    vao.unbind();
};

proto.update = function(options) {
    if (!options) {
        return;
    }

    if ("bounds" in options) {
        this.bounds = options.bounds;
    }

    if ("position" in options) {
        this.position = options.position;
    }

    if ("lineWidth" in options) {
        this.lineWidth = options.lineWidth;
    }

    if ("colors" in options) {
        this.colors = options.colors;
    }

    if ("enabled" in options) {
        this.enabled = options.enabled;
    }

    if ("drawSides" in options) {
        this.drawSides = options.drawSides;
    }
};

proto.dispose = function() {
    this.vao.dispose();
    this.buffer.dispose();
    this.shader.dispose();
};

function createSpikes(gl, options) {
    var data = [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, -1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, -1, 1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, -1, 0, 1, 0, 0, 1, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, -1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1];
    var buffer = createBuffer(gl, data);

    var vao = createVAO(gl, [{
        type: gl.FLOAT,
        buffer: buffer,
        size: 3,
        offset: 0,
        stride: 24
    }, {
        type: gl.FLOAT,
        buffer: buffer,
        size: 3,
        offset: 12,
        stride: 24
    }]);

    var shader = createShader(gl);
    shader.attributes.position.location = 0;
    shader.attributes.color.location = 1;
    var spikes = new AxisSpikes(gl, buffer, vao, shader);
    spikes.update(options);
    return spikes;
}
},{"gl-buffer":145,"gl-vao":161,"glslify":164,"glslify/adapter.js":163}],163:[function(require,module,exports){
module.exports = programify

var shader = require('gl-shader-core')

function programify(vertex, fragment, uniforms, attributes) {
  return function(gl) {
    return shader(gl, vertex, fragment, uniforms, attributes)
  }
}

},{"gl-shader-core":169}],164:[function(require,module,exports){
module.exports = noop

function noop() {
  throw new Error(
      'You should bundle your code ' +
      'using `glslify` as a transform.'
  )
}

},{}],165:[function(require,module,exports){
'use strict'

module.exports = createAttributeWrapper

//Shader attribute class
function ShaderAttribute(gl, program, location, dimension, name, constFunc, relink) {
  this._gl = gl
  this._program = program
  this._location = location
  this._dimension = dimension
  this._name = name
  this._constFunc = constFunc
  this._relink = relink
}

var proto = ShaderAttribute.prototype

proto.pointer = function setAttribPointer(type, normalized, stride, offset) {
  var gl = this._gl
  gl.vertexAttribPointer(this._location, this._dimension, type||gl.FLOAT, !!normalized, stride||0, offset||0)
  this._gl.enableVertexAttribArray(this._location)
}

Object.defineProperty(proto, 'location', {
  get: function() {
    return this._location
  }
  , set: function(v) {
    if(v !== this._location) {
      this._location = v
      this._gl.bindAttribLocation(this._program, v, this._name)
      this._gl.linkProgram(this._program)
      this._relink()
    }
  }
})


//Adds a vector attribute to obj
function addVectorAttribute(gl, program, location, dimension, obj, name, doLink) {
  var constFuncArgs = [ 'gl', 'v' ]
  var varNames = []
  for(var i=0; i<dimension; ++i) {
    constFuncArgs.push('x'+i)
    varNames.push('x'+i)
  }
  constFuncArgs.push([
    'if(x0.length===void 0){return gl.vertexAttrib', dimension, 'f(v,', varNames.join(), ')}else{return gl.vertexAttrib', dimension, 'fv(v,x0)}'
  ].join(''))
  var constFunc = Function.apply(undefined, constFuncArgs)
  var attr = new ShaderAttribute(gl, program, location, dimension, name, constFunc, doLink)
  Object.defineProperty(obj, name, {
    set: function(x) {
      gl.disableVertexAttribArray(attr._location)
      constFunc(gl, attr._location, x)
      return x
    }
    , get: function() {
      return attr
    }
    , enumerable: true
  })
}

//Create shims for attributes
function createAttributeWrapper(gl, program, attributes, doLink) {
  var obj = {}
  for(var i=0, n=attributes.length; i<n; ++i) {
    var a = attributes[i]
    var name = a.name
    var type = a.type
    var location = gl.getAttribLocation(program, name)
    
    switch(type) {
      case 'bool':
      case 'int':
      case 'float':
        addVectorAttribute(gl, program, location, 1, obj, name, doLink)
      break
      
      default:
        if(type.indexOf('vec') >= 0) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type for attribute ' + name + ': ' + type)
          }
          addVectorAttribute(gl, program, location, d, obj, name, doLink)
        } else {
          throw new Error('gl-shader: Unknown data type for attribute ' + name + ': ' + type)
        }
      break
    }
  }
  return obj
}
},{}],166:[function(require,module,exports){
'use strict'

var dup = require('dup')
var coallesceUniforms = require('./reflect')

module.exports = createUniformWrapper

//Binds a function and returns a value
function identity(x) {
  var c = new Function('y', 'return function(){return y}')
  return c(x)
}

//Create shims for uniforms
function createUniformWrapper(gl, program, uniforms, locations) {

  function makeGetter(index) {
    var proc = new Function('gl', 'prog', 'locations', 
      'return function(){return gl.getUniform(prog,locations[' + index + '])}') 
    return proc(gl, program, locations)
  }

  function makePropSetter(path, index, type) {
    switch(type) {
      case 'bool':
      case 'int':
      case 'sampler2D':
      case 'samplerCube':
        return 'gl.uniform1i(locations[' + index + '],obj' + path + ')'
      case 'float':
        return 'gl.uniform1f(locations[' + index + '],obj' + path + ')'
      default:
        var vidx = type.indexOf('vec')
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type')
          }
          switch(type.charAt(0)) {
            case 'b':
            case 'i':
              return 'gl.uniform' + d + 'iv(locations[' + index + '],obj' + path + ')'
            case 'v':
              return 'gl.uniform' + d + 'fv(locations[' + index + '],obj' + path + ')'
            default:
              throw new Error('gl-shader: Unrecognized data type for vector ' + name + ': ' + type)
          }
        } else if(type.indexOf('mat') === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid uniform dimension type for matrix ' + name + ': ' + type)
          }
          return 'gl.uniformMatrix' + d + 'fv(locations[' + index + '],false,obj' + path + ')'
        } else {
          throw new Error('gl-shader: Unknown uniform data type for ' + name + ': ' + type)
        }
      break
    }
  }

  function enumerateIndices(prefix, type) {
    if(typeof type !== 'object') {
      return [ [prefix, type] ]
    }
    var indices = []
    for(var id in type) {
      var prop = type[id]
      var tprefix = prefix
      if(parseInt(id) + '' === id) {
        tprefix += '[' + id + ']'
      } else {
        tprefix += '.' + id
      }
      if(typeof prop === 'object') {
        indices.push.apply(indices, enumerateIndices(tprefix, prop))
      } else {
        indices.push([tprefix, prop])
      }
    }
    return indices
  }

  function makeSetter(type) {
    var code = [ 'return function updateProperty(obj){' ]
    var indices = enumerateIndices('', type)
    for(var i=0; i<indices.length; ++i) {
      var item = indices[i]
      var path = item[0]
      var idx  = item[1]
      if(locations[idx]) {
        code.push(makePropSetter(path, idx, uniforms[idx].type))
      }
    }
    code.push('return obj}')
    var proc = new Function('gl', 'prog', 'locations', code.join('\n'))
    return proc(gl, program, locations)
  }

  function defaultValue(type) {
    switch(type) {
      case 'bool':
        return false
      case 'int':
      case 'sampler2D':
      case 'samplerCube':
        return 0
      case 'float':
        return 0.0
      default:
        var vidx = type.indexOf('vec')
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid data type')
          }
          if(type.charAt(0) === 'b') {
            return dup(d, false)
          }
          return dup(d)
        } else if(type.indexOf('mat') === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error('gl-shader: Invalid uniform dimension type for matrix ' + name + ': ' + type)
          }
          return dup([d,d])
        } else {
          throw new Error('gl-shader: Unknown uniform data type for ' + name + ': ' + type)
        }
      break
    }
  }

  function storeProperty(obj, prop, type) {
    if(typeof type === 'object') {
      var child = processObject(type)
      Object.defineProperty(obj, prop, {
        get: identity(child),
        set: makeSetter(type),
        enumerable: true,
        configurable: false
      })
    } else {
      if(locations[type]) {
        Object.defineProperty(obj, prop, {
          get: makeGetter(type),
          set: makeSetter(type),
          enumerable: true,
          configurable: false
        })
      } else {
        obj[prop] = defaultValue(uniforms[type].type)
      }
    }
  }

  function processObject(obj) {
    var result
    if(Array.isArray(obj)) {
      result = new Array(obj.length)
      for(var i=0; i<obj.length; ++i) {
        storeProperty(result, i, obj[i])
      }
    } else {
      result = {}
      for(var id in obj) {
        storeProperty(result, id, obj[id])
      }
    }
    return result
  }

  //Return data
  var coallesced = coallesceUniforms(uniforms, true)
  return {
    get: identity(processObject(coallesced)),
    set: makeSetter(coallesced),
    enumerable: true,
    configurable: true
  }
}

},{"./reflect":167,"dup":168}],167:[function(require,module,exports){
arguments[4][139][0].apply(exports,arguments)
},{"dup":139}],168:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],169:[function(require,module,exports){
'use strict'

var createUniformWrapper = require('./lib/create-uniforms')
var createAttributeWrapper = require('./lib/create-attributes')
var makeReflect = require('./lib/reflect')

//Shader object
function Shader(gl, prog, vertShader, fragShader) {
  this.gl = gl
  this.handle = prog
  this.attributes = null
  this.uniforms = null
  this.types = null
  this.vertexShader = vertShader
  this.fragmentShader = fragShader
}

//Binds the shader
Shader.prototype.bind = function() {
  this.gl.useProgram(this.handle)
}

//Destroy shader, release resources
Shader.prototype.dispose = function() {
  var gl = this.gl
  gl.deleteShader(this.vertexShader)
  gl.deleteShader(this.fragmentShader)
  gl.deleteProgram(this.handle)
}

Shader.prototype.updateExports = function(uniforms, attributes) {
  var locations = new Array(uniforms.length)
  var program = this.handle
  var gl = this.gl

  var doLink = relinkUniforms.bind(void 0,
    gl,
    program,
    locations,
    uniforms
  )
  doLink()

  this.types = {
    uniforms: makeReflect(uniforms),
    attributes: makeReflect(attributes)
  }

  this.attributes = createAttributeWrapper(
    gl,
    program,
    attributes,
    doLink
  )

  Object.defineProperty(this, 'uniforms', createUniformWrapper(
    gl,
    program,
    uniforms,
    locations
  ))
}

//Relinks all uniforms
function relinkUniforms(gl, program, locations, uniforms) {
  for(var i=0; i<uniforms.length; ++i) {
    locations[i] = gl.getUniformLocation(program, uniforms[i].name)
  }
}

//Compiles and links a shader program with the given attribute and vertex list
function createShader(
    gl
  , vertSource
  , fragSource
  , uniforms
  , attributes) {
  
  //Compile vertex shader
  var vertShader = gl.createShader(gl.VERTEX_SHADER)
  gl.shaderSource(vertShader, vertSource)
  gl.compileShader(vertShader)
  if(!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(vertShader)
    console.error('gl-shader: Error compling vertex shader:', errLog)
    throw new Error('gl-shader: Error compiling vertex shader:' + errLog)
  }
  
  //Compile fragment shader
  var fragShader = gl.createShader(gl.FRAGMENT_SHADER)
  gl.shaderSource(fragShader, fragSource)
  gl.compileShader(fragShader)
  if(!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(fragShader)
    console.error('gl-shader: Error compiling fragment shader:', errLog)
    throw new Error('gl-shader: Error compiling fragment shader:' + errLog)
  }
  
  //Link program
  var program = gl.createProgram()
  gl.attachShader(program, fragShader)
  gl.attachShader(program, vertShader)

  //Optional default attriubte locations
  attributes.forEach(function(a) {
    if (typeof a.location === 'number') 
      gl.bindAttribLocation(program, a.location, a.name)
  })

  gl.linkProgram(program)
  if(!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var errLog = gl.getProgramInfoLog(program)
    console.error('gl-shader: Error linking shader program:', errLog)
    throw new Error('gl-shader: Error linking shader program:' + errLog)
  }
  
  //Return final linked shader object
  var shader = new Shader(
    gl,
    program,
    vertShader,
    fragShader
  )
  shader.updateExports(uniforms, attributes)

  return shader
}

module.exports = createShader

},{"./lib/create-attributes":165,"./lib/create-uniforms":166,"./lib/reflect":167}],170:[function(require,module,exports){
module.exports = programify

function programify(vertex, fragment, uniforms, attributes) {
  return {
    vertex: vertex, 
    fragment: fragment,
    uniforms: uniforms, 
    attributes: attributes
  };
}

},{}],171:[function(require,module,exports){
'use strict'

module.exports = mouseListen

var mouse = require('mouse-event')

function mouseListen(element, callback) {
  
  if(!callback) {
    callback = element
    element = window
  }

  var buttonState = 0
  var x = 0
  var y = 0
  var mods = {
    shift:   false,
    alt:     false,
    control: false,
    meta:    false
  }

  function updateMods(ev) {
    var changed = false
    if('altKey' in ev) {
      changed = changed || ev.altKey !== mods.alt
      mods.alt = !!ev.altKey
    }
    if('shiftKey' in ev) {
      changed = changed || ev.shiftKey !== mods.shift
      mods.shift = !!ev.shiftKey
    }
    if('ctrlKey' in ev) {
      changed = changed || ev.ctrlKey !== mods.control
      mods.control = !!ev.ctrlKey
    }
    if('metaKey' in ev) {
      changed = changed || ev.metaKey !== mods.meta
      mods.meta = !!ev.metaKey
    }
    return changed
  }

  function handleEvent(nextButtons, ev) {
    var nextX = mouse.x(ev)
    var nextY = mouse.y(ev)
    if('buttons' in ev) {
      nextButtons = ev.buttons|0
    }
    if(nextButtons !== buttonState ||
       nextX !== x ||
       nextY !== y || 
       updateMods(ev)) {
      buttonState = nextButtons|0
      x = nextX||0
      y = nextY||0
      callback(buttonState, x, y, mods)
    }
  }

  function clearState(ev) {
    handleEvent(0, ev)
  }

  function handleBlur() {
    if(buttonState || 
      x || 
      y ||
      mods.shift ||
      mods.alt ||
      mods.meta ||
      mods.control) {

      x = y = 0
      buttonState = 0
      mods.shift = mods.alt = mods.control = mods.meta = false
      callback(0, 0, 0, mods)
    }
  }

  function handleMods(ev) {
    if(updateMods(ev)) {
      callback(buttonState, x, y, mods)
    }
  }

  element.addEventListener('mousemove', function(ev) {
    if(mouse.buttons(ev) === 0) {
      handleEvent(0, ev)
    } else {
      handleEvent(buttonState, ev)
    }
  })

  element.addEventListener('mousedown', function(ev) {
    handleEvent(buttonState | mouse.buttons(ev), ev)
  })

  element.addEventListener('mouseup', function(ev) {
    handleEvent(buttonState & ~mouse.buttons(ev), ev)
  })

  element.addEventListener('mouseleave', clearState)
  element.addEventListener('mouseenter', clearState)
  element.addEventListener('mouseout', clearState)
  element.addEventListener('mouseover', clearState)
  element.addEventListener('blur', handleBlur)
  element.addEventListener('keyup', handleMods)
  element.addEventListener('keydown', handleMods)
  element.addEventListener('keypress', handleMods)

  if(element !== window) {
    window.addEventListener('blur', handleBlur)
    window.addEventListener('keyup', handleMods)
    window.addEventListener('keydown', handleMods)
    window.addEventListener('keypress', handleMods)
  }
}
},{"mouse-event":172}],172:[function(require,module,exports){
'use strict'

function mouseButtons(ev) {
  if(typeof ev === 'object') {
    if('buttons' in ev) {
      return ev.buttons
    } else if('which' in ev) {
      var b = ev.which
      if(b === 2) {
        return 4
      } else if(b === 3) {
        return 2
      } else if(b > 0) {
        return 1<<(b-1)
      }
    } else if('button' in ev) {
      var b = ev.button
      if(b === 1) {
        return 4
      } else if(b === 2) {
        return 2
      } else if(b >= 0) {
        return 1<<b
      }
    }
  }
  return 0
}
exports.buttons = mouseButtons

function mouseElement(ev) {
  return ev.target || ev.srcElement || window
}
exports.element = mouseElement

function mouseRelativeX(ev) {
  if(typeof ev === 'object') {
    if('offsetX' in ev) {
      return ev.offsetX
    }
    var target = mouseElement(ev)
    if('clientX' in ev) {
      return ev.clientX - target.clientLeft
    }
    if('pageX' in ev) {
      return ev.pageX - target.offsetLeft
    }
  }
  return 0
}
exports.x = mouseRelativeX

function mouseRelativeY(ev) {
  if(typeof ev === 'object') {
    if('offsetY' in ev) {
      return ev.offsetY
    }
    var target = mouseElement(ev)
    if('clientY' in ev) {
      return ev.clientY - target.clientTop
    }
    if('pageX' in ev) {
      return ev.pageY - target.offsetTop
    }
  }
  return 0
}
exports.y = mouseRelativeY
},{}],173:[function(require,module,exports){
module.exports = function parseUnit(str, out) {
    if (!out)
        out = [ 0, '' ]

    str = String(str)
    var num = parseFloat(str, 10)
    out[0] = num
    out[1] = str.match(/[\d.\-\+]*\s*(.*)/)[1] || ''
    return out
}
},{}],174:[function(require,module,exports){
'use strict'

var parseUnit = require('parse-unit')

module.exports = toPX

var PIXELS_PER_INCH = 96

function getPropertyInPX(element, prop) {
  var parts = parseUnit(getComputedStyle(element).getPropertyValue(prop))
  return parts[0] * toPX(parts[1], element)
}

//This brutal hack is needed
function getSizeBrutal(unit, element) {
  var testDIV = document.createElement('div')
  testDIV.style['font-size'] = '128' + unit
  element.appendChild(testDIV)
  var size = getPropertyInPX(testDIV, 'font-size') / 128
  element.removeChild(testDIV)
  return size
}

function toPX(str, element) {
  element = element || document.body
  str = (str || 'px').trim().toLowerCase()
  if(element === window || element === document) {
    element = document.body 
  }
  switch(str) {
    case '%':  //Ambiguous, not sure if we should use width or height
      return element.clientHeight / 100.0
    case 'ch':
    case 'ex':
      return getSizeBrutal(str, element)
    case 'em':
      return getPropertyInPX(element, 'font-size')
    case 'rem':
      return getPropertyInPX(document.body, 'font-size')
    case 'vw':
      return window.innerWidth/100
    case 'vh':
      return window.innerHeight/100
    case 'vmin':
      return Math.min(window.innerWidth, window.innerHeight) / 100
    case 'vmax':
      return Math.max(window.innerWidth, window.innerHeight) / 100
    case 'in':
      return PIXELS_PER_INCH
    case 'cm':
      return PIXELS_PER_INCH / 2.54
    case 'mm':
      return PIXELS_PER_INCH / 25.4
    case 'pt':
      return PIXELS_PER_INCH / 72
    case 'pc':
      return PIXELS_PER_INCH / 6
  }
  return 1
}
},{"parse-unit":173}],175:[function(require,module,exports){
'use strict'

var toPX = require('to-px')

module.exports = mouseWheelListen

function mouseWheelListen(element, callback, noScroll) {
  if(typeof element === 'function') {
    noScroll = !!callback
    callback = element
    element = window
  }
  var lineHeight = toPX('ex', element)
  element.addEventListener('wheel', function(ev) {
    if(noScroll) {
      ev.preventDefault()
    }
    var dx = ev.deltaX || 0
    var dy = ev.deltaY || 0
    var dz = ev.deltaZ || 0
    var mode = ev.deltaMode
    var scale = 1
    switch(mode) {
      case 1:
        scale = lineHeight
      break
      case 2:
        scale = window.innerHeight
      break
    }
    dx *= scale
    dy *= scale
    dz *= scale
    if(dx || dy || dz) {
      return callback(dx, dy, dz)
    }
  })
}
},{"to-px":174}],176:[function(require,module,exports){
'use strict'

module.exports = quatFromFrame

function quatFromFrame(
  out,
  rx, ry, rz,
  ux, uy, uz,
  fx, fy, fz) {
  var tr = rx + uy + fz
  if(l > 0) {
    var l = Math.sqrt(tr + 1.0)
    out[0] = 0.5 * (uz - fy) / l
    out[1] = 0.5 * (fx - rz) / l
    out[2] = 0.5 * (ry - uy) / l
    out[3] = 0.5 * l
  } else {
    var tf = Math.max(rx, uy, fz)
    var l = Math.sqrt(2 * tf - tr + 1.0)
    if(rx >= tf) {
      //x y z  order
      out[0] = 0.5 * l
      out[1] = 0.5 * (ux + ry) / l
      out[2] = 0.5 * (fx + rz) / l
      out[3] = 0.5 * (uz - fy) / l
    } else if(uy >= tf) {
      //y z x  order
      out[0] = 0.5 * (ry + ux) / l
      out[1] = 0.5 * l
      out[2] = 0.5 * (fy + uz) / l
      out[3] = 0.5 * (fx - rz) / l
    } else {
      //z x y  order
      out[0] = 0.5 * (rz + fx) / l
      out[1] = 0.5 * (uz + fy) / l
      out[2] = 0.5 * l
      out[3] = 0.5 * (ry - ux) / l
    }
  }
  return out
}
},{}],177:[function(require,module,exports){
'use strict'

module.exports = createFilteredVector

var cubicHermite = require('cubic-hermite')
var bsearch = require('binary-search-bounds')

function clamp(lo, hi, x) {
  return Math.min(hi, Math.max(lo, x))  
}

function FilteredVector(state0, velocity0, t0) {
  this.dimension  = state0.length
  this.bounds     = [ new Array(this.dimension), new Array(this.dimension) ]
  for(var i=0; i<this.dimension; ++i) {
    this.bounds[0][i] = -Infinity
    this.bounds[1][i] = Infinity
  }
  this._state     = state0.slice().reverse()
  this._velocity  = velocity0.slice().reverse()
  this._time      = [ t0 ]
  this._scratch   = [ state0.slice(), state0.slice(), state0.slice(), state0.slice(), state0.slice() ]
}

var proto = FilteredVector.prototype

proto.flush = function(t) {
  var idx = bsearch.gt(this._time, t) - 1
  if(idx <= 0) {
    return
  }
  this._time.splice(0, idx)
  this._state.splice(0, idx * this.dimension)
  this._velocity.splice(0, idx * this.dimension)
}

proto.curve = function(t) {
  var time      = this._time
  var n         = time.length
  var idx       = bsearch.le(time, t)
  var result    = this._scratch[0]
  var state     = this._state
  var velocity  = this._velocity
  var d         = this.dimension
  var bounds    = this.bounds
  if(idx >= n-1) {
    var ptr = state.length-1
    var tf = t - time[n-1]
    for(var i=0; i<d; ++i, --ptr) {
      result[i] = state[ptr] + tf * velocity[ptr]
    }
  } else {
    var ptr = d * (idx+1) - 1
    var t0  = time[idx]
    var t1  = time[idx+1]
    var dt  = (t1 - t0) || 1.0
    var x0  = this._scratch[1]
    var x1  = this._scratch[2]
    var v0  = this._scratch[3]
    var v1  = this._scratch[4]
    var steady = true
    for(var i=0; i<d; ++i, --ptr) {
      x0[i] = state[ptr]
      v0[i] = velocity[ptr] * dt
      x1[i] = state[ptr+d]
      v1[i] = velocity[ptr+d] * dt
      steady = steady && (x0[i] === x1[i] && v0[i] === v1[i] && v0[i] === 0.0)
    }
    if(steady) {
      for(var i=0; i<d; ++i) {
        result[i] = x0[i]
      }
    } else {
      cubicHermite(x0, v0, x1, v1, (t-t0)/dt, result)
    }
  }
  var lo = bounds[0]
  var hi = bounds[1]
  for(var i=0; i<d; ++i) {
    result[i] = clamp(lo[i], hi[i], result[i])
  }
  return result
}

proto.dcurve = function(t) {
  var time     = this._time
  var n        = time.length
  var idx      = bsearch.le(time, t)
  var result   = this._scratch[0]
  var state    = this._state
  var velocity = this._velocity
  var d        = this.dimension
  if(idx >= n-1) {
    var ptr = state.length-1
    var tf = t - time[n-1]
    for(var i=0; i<d; ++i, --ptr) {
      result[i] = velocity[ptr]
    }
  } else {
    var ptr = d * (idx+1) - 1
    var t0 = time[idx]
    var t1 = time[idx+1]
    var dt = (t1 - t0) || 1.0
    var x0 = this._scratch[1]
    var x1 = this._scratch[2]
    var v0 = this._scratch[3]
    var v1 = this._scratch[4]
    var steady = true
    for(var i=0; i<d; ++i, --ptr) {
      x0[i] = state[ptr]
      v0[i] = velocity[ptr] * dt
      x1[i] = state[ptr+d]
      v1[i] = velocity[ptr+d] * dt
      steady = steady && (x0[i] === x1[i] && v0[i] === v1[i] && v0[i] === 0.0)
    }
    if(steady) {
      for(var i=0; i<d; ++i) {
        result[i] = 0.0
      }
    } else {
      cubicHermite.derivative(x0, v0, x1, v1, (t-t0)/dt, result)
      for(var i=0; i<d; ++i) {
        result[i] /= dt
      }
    }
  }
  return result
}

proto.lastT = function() {
  var time = this._time
  return time[time.length-1]
}

proto.stable = function() {
  var velocity = this._velocity
  var ptr = velocity.length
  for(var i=this.dimension-1; i>=0; --i) {
    if(velocity[--ptr]) {
      return false
    }
  }
  return true
}

proto.jump = function(t) {
  var t0 = this.lastT()
  var d  = this.dimension
  if(t < t0 || arguments.length !== d+1) {
    return
  }
  var state     = this._state
  var velocity  = this._velocity
  var ptr       = state.length-this.dimension
  var bounds    = this.bounds
  var lo        = bounds[0]
  var hi        = bounds[1]
  this._time.push(t0, t)
  for(var j=0; j<2; ++j) {
    for(var i=0; i<d; ++i) {
      state.push(state[ptr++])
      velocity.push(0)
    }
  }
  this._time.push(t)
  for(var i=d; i>0; --i) {
    state.push(clamp(lo[i-1], hi[i-1], arguments[i]))
    velocity.push(0)    
  }
}

proto.push = function(t) {
  var t0 = this.lastT()
  var d  = this.dimension
  if(t < t0 || arguments.length !== d+1) {
    return
  }
  var state     = this._state
  var velocity  = this._velocity
  var ptr       = state.length-this.dimension
  var dt        = t - t0
  var bounds    = this.bounds
  var lo        = bounds[0]
  var hi        = bounds[1]
  var sf        = (dt > 1e-6) ? 1/dt : 0
  this._time.push(t)
  for(var i=d; i>0; --i) {
    var xc = clamp(lo[i-1], hi[i-1], arguments[i])
    state.push(xc)
    velocity.push((xc - state[ptr++]) * sf)
  }
}

proto.set = function(t) {
  var d = this.dimension
  if(t < this.lastT() || arguments.length !== d+1) {
    return
  }
  var state     = this._state
  var velocity  = this._velocity
  var bounds    = this.bounds
  var lo        = bounds[0]
  var hi        = bounds[1]
  this._time.push(t)
  for(var i=d; i>0; --i) {
    state.push(clamp(lo[i-1], hi[i-1], arguments[i]))
    velocity.push(0)
  }
}

proto.move = function(t) {
  var t0 = this.lastT()
  var d  = this.dimension
  if(t <= t0 || arguments.length !== d+1) {
    return
  }
  var state    = this._state
  var velocity = this._velocity
  var statePtr = state.length - this.dimension
  var bounds   = this.bounds
  var lo       = bounds[0]
  var hi       = bounds[1]
  var dt       = t - t0
  var sf       = (dt > 1e-6) ? 1/dt : 0.0
  this._time.push(t)
  for(var i=d; i>0; --i) {
    var dx = arguments[i]
    state.push(clamp(lo[i-1], hi[i-1], state[statePtr++] + dx))
    velocity.push(dx * sf)
  }
}

proto.idle = function(t) {
  var t0 = this.lastT()
  if(t < t0) {
    return
  }
  var d        = this.dimension
  var state    = this._state
  var velocity = this._velocity
  var statePtr = state.length-d
  var bounds   = this.bounds
  var lo       = bounds[0]
  var hi       = bounds[1]
  var dt       = t - t0
  this._time.push(t)
  for(var i=d-1; i>=0; --i) {
    state.push(clamp(lo[i], hi[i], state[statePtr] + dt * velocity[statePtr]))
    velocity.push(0)
    statePtr += 1
  }
}

function getZero(d) {
  var result = new Array(d)
  for(var i=0; i<d; ++i) {
    result[i] = 0.0
  }
  return result
}

function createFilteredVector(initState, initVelocity, initTime) {
  switch(arguments.length) {
    case 0:
      return new FilteredVector([0], [0], 0)
    case 1:
      if(typeof initState === 'number') {
        var zero = getZero(initState)
        return new FilteredVector(zero, zero, 0)
      } else {
        return new FilteredVector(initState, getZero(initState.length), 0)
      }
    case 2:
      if(typeof initVelocity === 'number') {
        var zero = getZero(initState.length)
        return new FilteredVector(initState, zero, +initVelocity)
      } else {
        initTime = 0
      }
    case 3:
      if(initState.length !== initVelocity.length) {
        throw new Error('state and velocity lengths must match')
      }
      return new FilteredVector(initState, initVelocity, initTime)
  }
}
},{"binary-search-bounds":178,"cubic-hermite":179}],178:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"dup":67}],179:[function(require,module,exports){
"use strict"

function dcubicHermite(p0, v0, p1, v1, t, f) {
  var dh00 = 6*t*t-6*t,
      dh10 = 3*t*t-4*t + 1,
      dh01 = -6*t*t+6*t,
      dh11 = 3*t*t-2*t
  if(p0.length) {
    if(!f) {
      f = new Array(p0.length)
    }
    for(var i=p0.length-1; i>=0; --i) {
      f[i] = dh00*p0[i] + dh10*v0[i] + dh01*p1[i] + dh11*v1[i]
    }
    return f
  }
  return dh00*p0 + dh10*v0 + dh01*p1[i] + dh11*v1
}

function cubicHermite(p0, v0, p1, v1, t, f) {
  var ti  = (t-1), t2 = t*t, ti2 = ti*ti,
      h00 = (1+2*t)*ti2,
      h10 = t*ti2,
      h01 = t2*(3-2*t),
      h11 = t2*ti
  if(p0.length) {
    if(!f) {
      f = new Array(p0.length)
    }
    for(var i=p0.length-1; i>=0; --i) {
      f[i] = h00*p0[i] + h10*v0[i] + h01*p1[i] + h11*v1[i]
    }
    return f
  }
  return h00*p0 + h10*v0 + h01*p1 + h11*v1
}

module.exports = cubicHermite
module.exports.derivative = dcubicHermite
},{}],180:[function(require,module,exports){
'use strict'

module.exports = createOrbitController

var filterVector  = require('filtered-vector')
var lookAt        = require('gl-mat4/lookAt')
var mat4FromQuat  = require('gl-mat4/fromQuat')
var invert44      = require('gl-mat4/invert')
var quatFromFrame = require('./lib/quatFromFrame')

function len3(x,y,z) {
  return Math.sqrt(Math.pow(x,2) + Math.pow(y,2) + Math.pow(z,2))
}

function len4(w,x,y,z) {
  return Math.sqrt(Math.pow(w,2) + Math.pow(x,2) + Math.pow(y,2) + Math.pow(z,2))
}

function normalize4(out, a) {
  var ax = a[0]
  var ay = a[1]
  var az = a[2]
  var aw = a[3]
  var al = len4(ax, ay, az, aw)
  if(al > 1e-6) {
    out[0] = ax/al
    out[1] = ay/al
    out[2] = az/al
    out[3] = aw/al
  } else {
    out[0] = out[1] = out[2] = 0.0
    out[3] = 1.0
  }
}

function OrbitCameraController(initQuat, initCenter, initRadius) {
  this.radius    = filterVector([initRadius])
  this.center    = filterVector(initCenter)
  this.rotation  = filterVector(initQuat)

  this.computedRadius   = this.radius.curve(0)
  this.computedCenter   = this.center.curve(0)
  this.computedRotation = this.rotation.curve(0)
  this.computedUp       = [0.1,0,0]
  this.computedEye      = [0.1,0,0]
  this.computedMatrix   = [0.1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]

  this.recalcMatrix(0)
}

var proto = OrbitCameraController.prototype

proto.lastT = function() {
  return Math.max(
    this.radius.lastT(),
    this.center.lastT(),
    this.rotation.lastT())
}

proto.recalcMatrix = function(t) {
  this.radius.curve(t)
  this.center.curve(t)
  this.rotation.curve(t)

  var quat = this.computedRotation
  normalize4(quat, quat)

  var mat = this.computedMatrix
  mat4FromQuat(mat, quat)

  var center = this.computedCenter
  var eye    = this.computedEye
  var up     = this.computedUp
  var radius = Math.exp(this.computedRadius[0])
  eye[0] = center[0] + radius * mat[2]
  eye[1] = center[1] + radius * mat[6]
  eye[2] = center[2] + radius * mat[10]
  up[0] = mat[1]
  up[1] = mat[5]
  up[2] = mat[9]
  for(var i=0; i<3; ++i) {
    var rr = 0.0
    for(var j=0; j<3; ++j) {
      rr += mat[i+4*j] * eye[j]
    }
    mat[12+i] = -rr
  }
}

proto.getMatrix = function(t, result) {
  this.recalcMatrix(t)
  var m = this.computedMatrix
  if(result) {
    for(var i=0; i<16; ++i) {
      result[i] = m[i]
    }
    return result
  }
  return m
}

proto.idle = function(t) {
  this.center.idle(t)
  this.radius.idle(t)
  this.rotation.idle(t)
}

proto.flush = function(t) {
  this.center.flush(t)
  this.radius.flush(t)
  this.rotation.flush(t)
}

proto.pan = function(t, dx, dy, dz) {
  dx = dx || 0.0
  dy = dy || 0.0
  dz = dz || 0.0

  this.recalcMatrix(t)
  var mat = this.computedMatrix

  var ux = mat[1]
  var uy = mat[5]
  var uz = mat[9]
  var ul = len3(ux, uy, uz)
  ux /= ul
  uy /= ul
  uz /= ul

  var rx = mat[0]
  var ry = mat[4]
  var rz = mat[8]
  var ru = rx * ux + ry * uy + rz * uz
  rx -= ux * ru
  ry -= uy * ru
  rz -= uz * ru
  var rl = len3(rx, ry, rz)
  rx /= rl
  ry /= rl
  rz /= rl

  var fx = mat[2]
  var fy = mat[6]
  var fz = mat[10]
  var fu = fx * ux + fy * uy + fz * uz
  var fr = fx * rx + fy * ry + fz * rz
  fx -= fu * ux + fr * rx
  fy -= fu * uy + fr * ry
  fz -= fu * uz + fr * rz
  var fl = len3(fx, fy, fz)
  fx /= fl
  fy /= fl
  fz /= fl

  var vx = rx * dx + ux * dy
  var vy = ry * dx + uy * dy
  var vz = rz * dx + uz * dy

  this.center.move(t, vx, vy, vz)

  //Update z-component of radius
  var radius = Math.exp(this.computedRadius[0])
  radius = Math.max(1e-4, radius + dz)
  this.radius.set(t, Math.log(radius))
}

proto.rotate = function(t, dx, dy, dz) {
  this.recalcMatrix(t)

  dx = dx||0.0
  dy = dy||0.0

  var mat = this.computedMatrix

  var rx = mat[0]
  var ry = mat[4]
  var rz = mat[8]

  var ux = mat[1]
  var uy = mat[5]
  var uz = mat[9]

  var fx = mat[2]
  var fy = mat[6]
  var fz = mat[10]

  var qx = dx * rx + dy * ux
  var qy = dx * ry + dy * uy
  var qz = dx * rz + dy * uz

  var bx = -(fy * qz - fz * qy)
  var by = -(fz * qx - fx * qz)
  var bz = -(fx * qy - fy * qx)  
  var bw = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(bx,2) - Math.pow(by,2) - Math.pow(bz,2)))
  var bl = len4(bx, by, bz, bw)
  if(bl > 1e-6) {
    bx /= bl
    by /= bl
    bz /= bl
    bw /= bl
  } else {
    bx = by = bz = 0.0
    bw = 1.0
  }

  var rotation = this.computedRotation
  var ax = rotation[0]
  var ay = rotation[1]
  var az = rotation[2]
  var aw = rotation[3]

  var cx = ax*bw + aw*bx + ay*bz - az*by
  var cy = ay*bw + aw*by + az*bx - ax*bz
  var cz = az*bw + aw*bz + ax*by - ay*bx
  var cw = aw*bw - ax*bx - ay*by - az*bz
  
  //Apply roll
  if(dz) {
    bx = fx
    by = fy
    bz = fz
    var s = Math.sin(dz) / len3(bx, by, bz)
    bx *= s
    by *= s
    bz *= s
    bw = Math.cos(dx)
    cx = cx*bw + cw*bx + cy*bz - cz*by
    cy = cy*bw + cw*by + cz*bx - cx*bz
    cz = cz*bw + cw*bz + cx*by - cy*bx
    cw = cw*bw - cx*bx - cy*by - cz*bz
  }

  var cl = len4(cx, cy, cz, cw)
  if(cl > 1e-6) {
    cx /= cl
    cy /= cl
    cz /= cl
    cw /= cl
  } else {
    cx = cy = cz = 0.0
    cw = 1.0
  }

  this.rotation.set(t, cx, cy, cz, cw)
}

proto.lookAt = function(t, eye, center, up) {
  this.recalcMatrix(t)

  center = center || this.computedCenter
  eye    = eye    || this.computedEye
  up     = up     || this.computedUp

  var mat = this.computedMatrix
  lookAt(mat, eye, center, up)

  var rotation = this.computedRotation
  quatFromFrame(rotation,
    mat[0], mat[1], mat[2],
    mat[4], mat[5], mat[6],
    mat[8], mat[9], mat[10])
  normalize4(rotation, rotation)
  this.rotation.set(t, rotation[0], rotation[1], rotation[2], rotation[3])

  var fl = 0.0
  for(var i=0; i<3; ++i) {
    fl += Math.pow(center[i] - eye[i], 2)
  }
  this.radius.set(t, 0.5 * Math.log(Math.max(fl, 1e-6)))

  this.center.set(t, center[0], center[1], center[2])
}

proto.translate = function(t, dx, dy, dz) {
  this.center.move(t,
    dx||0.0,
    dy||0.0,
    dz||0.0)
}

proto.setMatrix = function(t, matrix) {
  this.recalcMatrix(t)

  var rotation = this.computedRotation
  quatFromFrame(rotation,
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10])
  normalize4(rotation, rotation)
  this.rotation.set(t, rotation[0], rotation[1], rotation[2], rotation[3])

  var mat = this.computedMatrix
  invert44(mat, matrix)
  var w = -mat[15]
  if(Math.abs(w) > 1e-6) {
    var cx = mat[12]/w
    var cy = mat[13]/w
    var cz = mat[14]/w

    var fx = mat[8]
    var fy = mat[9]
    var fz = mat[10]
    var fl = len3(fx, fy, fz)

    var r = Math.exp(this.computedRadius[0])

    cx -= fx * r / fl
    cy -= fy * r / fl
    cz -= fz * r / fl


    this.center.set(t, cx, cy, cz)
    this.radius.idle(t)
  } else {
    this.center.idle(t)
    this.radius.idle(t)
  }
}

proto.setDistance = function(t, d) {
  if(d > 0) {
    this.radius.set(t, Math.log(d))
  }
}

proto.setDistanceLimits = function(lo, hi) {
  if(lo > 0) {
    lo = Math.log(lo)
  } else {
    lo = -Infinity    
  }
  if(hi > 0) {
    hi = Math.log(hi)
  }
  hi = Math.max(hi, lo)
  this.radius.bounds[0][0] = lo
  this.radius.bounds[1][0] = hi
}

proto.getDistanceLimits = function(out) {
  var bounds = this.radius.bounds
  if(out) {
    out[0] = Math.exp(bounds[0][0])
    out[1] = Math.exp(bounds[1][0])
    return out
  }
  return [ Math.exp(bounds[0][0]), Math.exp(bounds[1][0]) ]
}

proto.toJSON = function() {
  this.recalcMatrix(this.lastT())
  return {
    center:   this.computedCenter.slice(),
    rotation: this.computedRotation.slice(),
    distance: Math.log(this.computedRadius[0]),
    zoomMin:  this.radius.bounds[0][0],
    zoomMax:  this.radius.bounds[1][0]
  }
}

proto.fromJSON = function(options) {
  var t = this.lastT()
  var c = options.centers
  if(c) {
    this.center.set(t, c[0], c[1], c[2])
  }
  var r = options.rotation
  if(r) {
    this.rotation.set(t, r[0], r[1], r[2], r[3])
  }
  var d = options.distance
  if(d && d > 0) {
    this.radius.set(t, Math.log(d))
  }
  this.setDistanceLimits(options.zoomMin, options.zoomMax)
}

function createOrbitController(options) {
  options = options || {}
  var center   = options.center   || [0,0,0]
  var rotation = options.rotation || [0,0,0,1]
  var radius   = options.radius   || 1.0

  center = [].slice.call(center, 0, 3)
  rotation = [].slice.call(rotation, 0, 4)
  normalize4(rotation, rotation)

  var result = new OrbitCameraController(
    rotation,
    center,
    Math.log(radius))

  result.setDistanceLimits(options.zoomMin, options.zoomMax)

  if('eye' in options || 'up' in options) {
    result.lookAt(0, options.eye, options.center, options.up)
  }

  return result
}
},{"./lib/quatFromFrame":176,"filtered-vector":177,"gl-mat4/fromQuat":121,"gl-mat4/invert":123,"gl-mat4/lookAt":124}],181:[function(require,module,exports){
(function (global){
module.exports =
  global.performance &&
  global.performance.now ? function now() {
    return performance.now()
  } : Date.now || function now() {
    return +new Date
  }

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],182:[function(require,module,exports){
'use strict'

module.exports = createOrbiter

var createController = require('orbit-camera-controller')
var mouseChange      = require('mouse-change')
var mouseWheel       = require('mouse-wheel')
var now              = require('right-now')

function copyVec(a, b) {
  a[0] = b[0]
  a[1] = b[1]
  a[2] = b[2]
}

function Orbiter(element, controller) {
  this.element        = element
  this.controller     = controller
  this.matrix         = new Array(16)
  this.rotation       = new Array(4)
  this.up             = new Array(3)
  this.eye            = new Array(3)
  this.center         = new Array(3)
  this.distance       = 0.0
  this.delay          = 40
  this.inputEnabled   = true
  this.flipX          = false
  this.flipY          = false
  this.translateSpeed = 1
  this.zoomSpeed      = 1
  this.rotateSpeed    = 1
  this.changed        = true
}

var proto = Orbiter.prototype

proto.toJSON = function() {
  var t = this.lastT()
  controller.recalcMatrix(t)
  return {
    camera:         this.controller.toJSON(),
    delay:          this.delay,
    flipX:          this.flipX,
    flipY:          this.flipY,
    translateSpeed: this.translateSpeed,
    zoomSpeed:      this.zoomSpeed,
    rotateSpeed:    this.rotateSpeed
  }
}

proto.fromJSON = function(options) {
  if('camera' in options) {
    this.controller.fromJSON(options.camera)
  }

  var self = this
  function handleOption(prop) {
    if(prop in options) {
      self[prop] = options[prop]
    }
  }
  handleOption('delay')
  handleOption('inputEnabled')
  handleOption('flipX')
  handleOption('flipY')
  handleOption('translateSpeed')
  handleOption('zoomSpeed')
  handleOption('rotateSpeed')
  this.changed = true
}

proto.tick = function() {
  var t = now()
  var delay = this.delay
  var controller = this.controller
  controller.idle(t - 0.5 * delay)
  controller.flush(t - (1000 * (1 + Math.min(delay,0))))
  controller.recalcMatrix(t - delay)

  var prevMat = this.matrix
  var nextMat = controller.computedMatrix
  var changed = this.changed
  for(var i=0; i<16; ++i) {
    changed = changed || (Math.abs(nextMat[i] - prevMat[i]) > 1e-5)
    prevMat[i] = nextMat[i]
  }

  var prevRot = this.rotation
  var nextRot = controller.computedRotation
  for(var i=0; i<4; ++i) {
    prevRot[i] = nextRot[i]
  }

  copyVec(this.eye,    controller.computedEye)
  copyVec(this.up,     controller.computedUp)
  copyVec(this.center, controller.computedCenter)
  this.distance = Math.exp(controller.computedRadius[0])

  //Clear change flag
  this.changed = false

  return changed
}

proto.lookAt = function(eye, center, up) {
  this.controller.lookAt(this.lastT(), eye, center, up)
}


var scratchEye    = [0,0,0]
var scratchCenter = [0,0,0]
var scratchUp     = [0,1,0]
proto.box = function(lo, hi) {
  var diam = 0
  for(var i=0; i<3; ++i) {
    eye[i] = center[i] = 0.5 * (lo[i]+hi[i])
    diam = Math.max(diam, hi[i] - lo[i])
  }
  eye[1] = hi[1] + 2 * diam
  this.controller.lookAt(now(), eye, center, up)
}

proto.setMatrix = function(mat) {
  this.controller.setMatrix(this.lastT(), mat)
}

proto.setDistance = function(d) {
  this.controller.setDistance(this.lastT(), d)
}

proto.setDistanceLimits = function(lo, hi) {
  this.controller.setDistanceLimits(lo, hi)
}

proto.rotate = function(pitch, yaw, roll) {
  this.controller.rotate(now(), pitch, yaw, roll)
}

proto.pan = function(dx, dy, dz) {
  this.controller.pan(now(), dx, dy, dz)
}

proto.translate = function(dx, dy, dz) {
  this.controller.translate(now(), dx, dy, dz)
}

proto.lastT = function() {
  return this.controller.lastT()
}

function createOrbiter(element, options) {

  //Create orbiter
  var controller = createController(options)
  var orbiter = new Orbiter(element, controller)
  orbiter.fromJSON(options)
  orbiter.tick()
  orbiter.changed = true

  //Hook input handlers
  var lastX = 0, lastY = 0
  mouseChange(element, function(buttons, x, y, mods) {
    if(!orbiter.inputEnabled) {
      return
    }

    var height = element.clientHeight
    var width  = element.clientWidth

    var scale = 1.0 / height
    var dx    = scale * (x - lastX)
    var dy    = scale * (y - lastY)
    var t     = now()

    var flipX = orbiter.flipX ? 1 : -1
    var flipY = orbiter.flipY ? 1 : -1

    var vrot  = Math.PI * orbiter.rotateSpeed
    var vpan  = +orbiter.translateSpeed
    var vzoom = +orbiter.zoomSpeed

    var distance = orbiter.distance

    if(buttons & 1) {
      if(mods.shift) {
        controller.rotate(t, 0, 0, -dx * drot)
      } else {
        controller.rotate(t, flipX * vrot * dx, -flipY * vrot * dy, 0)
      }
    } else if(buttons & 2) {
      controller.pan(t, -vpan * dx * distance * height / width, vpan * dy * distance, 0)
    } else if(buttons & 4) {
      controller.pan(t, 0, 0, vzoom * dy * distance)
    }

    lastX = x
    lastY = y
  })

  mouseWheel(element, function(dx, dy, dz) {
    if(!orbiter.inputEnabled) {
      return
    }

    var t        = now()
    var flipX    = orbiter.flipX ? 1 : -1
    var vrot     = Math.PI * orbiter.rotateSpeed
    var vzoom    = +orbiter.zoomSpeed
    var distance = orbiter.distance

    if(Math.abs(dx) > Math.abs(dy)) {
      controller.rotate(t, 0, 0, -dx * flipX * vrot / window.innerWidth)
    } else {
      controller.pan(t, 0, 0, vzoom * dy / window.innerHeight * distance)
    }
  }, true)


  element.addEventListener('contextmenu', function(ev) {
    if(orbiter.inputEnabled) {
      ev.preventDefault()
      return false
    }
  })

  return orbiter
}
},{"mouse-change":171,"mouse-wheel":175,"orbit-camera-controller":180,"right-now":181}],183:[function(require,module,exports){
'use strict'

module.exports = createScene

var createCamera = require('orbiter')
var createAxes   = require('gl-axes3d')
var axesRanges   = require('gl-axes3d/properties')
var createSpikes = require('gl-spikes3d')
var createSelect = require('gl-select-static')
var createFBO    = require('gl-fbo')
var drawTriangle = require('a-big-triangle')
var mouseChange  = require('mouse-change')
var perspective  = require('gl-mat4/perspective')
var createShader = require('./lib/shader')

function MouseSelect() {
  this.mouse          = [-1,-1]
  this.screen         = null
  this.distance       = Infinity
  this.index          = null
  this.dataCoordinate = null
  this.dataPosition   = null
  this.object         = null
  this.data           = null
}

function roundUpPow10(x) {
  var y = Math.round(Math.log(Math.abs(x)) / Math.log(10))
  if(y < 0) {
    var base = Math.round(Math.pow(10, -y))
    return Math.ceil(x*base) / base
  } else if(y > 0) {
    var base = Math.round(Math.pow(10, y))
    return Math.ceil(x/base) * base
  }
  return Math.ceil(x)
}

function defaultBool(x) {
  if(typeof x === 'boolean') {
    return x
  }
  return true
}

function createScene(options) {
  options = options || {}

  var stopped = false

  var pixelRatio = options.pixelRatio || parseFloat(window.devicePixelRatio)

  var canvas = options.canvas
  if(!canvas) {
    canvas = document.createElement('canvas')
    if(options.container) {
      var container = options.container
      canvas.width = container.clientWidth * pixelRatio
      canvas.height = container.clientHeight * pixelRatio
      container.appendChild(canvas)
    } else {
      canvas.width = window.innerWidth * pixelRatio
      canvas.height = window.innerHeight * pixelRatio
      document.body.appendChild(canvas)
    }
  }

  var gl = options.gl
  if(!gl) {
    var glOptions = options.glOptions || { premultipliedAlpha: true, antialias: true }
    gl = canvas.getContext('webgl', glOptions)
  }
  if(!gl) {
    throw new Error('webgl not supported')
  }

  //Initial bounds
  var bounds = options.bounds || [[-10,-10,-10], [10,10,10]]

  //Create selection
  var selection = new MouseSelect()

  //Accumulation buffer
  var accumBuffer = createFBO(gl,
    [gl.drawingBufferWidth, gl.drawingBufferHeight], {
      preferFloat: true
    })

  var accumShader = createShader(gl)

  //Create a camera
  var cameraOptions = options.camera || {
    eye:    [0,0,2],
    center: [0,0,0],
    up:     [0,1,0],
    zoomMin: 0.1,
    zoomMax: 100
  }
  var camera = createCamera(canvas, cameraOptions)

  //Create axes
  var axesOptions = options.axes || {}
  var axes = createAxes(gl, axesOptions)
  axes.enable = !axesOptions.disable

  //Create spikes
  var spikeOptions = options.spikes || {}
  var spikes = createSpikes(gl, spikeOptions)
  
  //Object list is empty initially
  var objects         = []
  var pickBufferIds   = []
  var pickBufferCount = []
  var pickBuffers     = []

  //Dirty flag, skip redraw if scene static
  var dirty       = true
  var pickDirty   = true
  
  var projection     = new Array(16)
  var model          = new Array(16)
  
  var cameraParams = {
    view:         camera.matrix,
    projection:   projection,
    model:        model
  }

  var pickDirty = true

  var viewShape = [ gl.drawingBufferWidth, gl.drawingBufferHeight ]

  //Create scene object
  var scene = {
    gl:           gl,
    pixelRatio:   options.pixelRatio || parseFloat(window.devicePixelRatio),
    canvas:       canvas,
    selection:    selection,
    camera:       camera,
    axes:         axes,
    axesPixels:   null,
    spikes:       spikes,
    bounds:       bounds,
    objects:      objects,
    shape:        viewShape,
    pickRadius:   options.pickRadius || 10,
    zNear:        options.zNear || 0.01,
    zFar:         options.zFar  || 1000,
    fovy:         options.fovy  || Math.PI/4,
    clearColor:   options.clearColor || [0,0,0,0],
    autoResize:   defaultBool(options.autoResize),
    autoBounds:   defaultBool(options.autoBounds),
    autoScale:    defaultBool(options.autoScale),
    autoCenter:   defaultBool(options.autoCenter),
    clipToBounds: defaultBool(options.clipToBounds),
    snapToData:   !!options.snapToData,
    onselect:     options.onselect || null,
    onrender:     options.onrender || null,
    onclick:      options.onclick  || null,
    cameraParams: cameraParams
  }

  var pickShape = [ (gl.drawingBufferWidth/scene.pixelRatio)|0, (gl.drawingBufferHeight/scene.pixelRatio)|0 ]

  function resizeListener() {
    if(!scene.autoResize) {
      return
    }
    var style = canvas.style
    style.position = style.position || 'absolute'
    style.left     = '0px'
    style.top      = '0px'
    var parent = canvas.parentNode
    var width  = 1
    var height = 1
    if(parent && parent !== document.body) {
      width  = parent.clientWidth
      height = parent.clientHeight
    } else {
      width  = window.innerWidth
      height = window.innerHeight
    }
    canvas.width  = Math.ceil(width  * scene.pixelRatio)|0
    canvas.height = Math.ceil(height * scene.pixelRatio)|0
    style.width   = width  + 'px'
    style.height  = height + 'px'
  }
  if(scene.autoResize) {
    resizeListener()
  }

  window.addEventListener('resize', resizeListener)

  function reallocPickIds() {
    var numObjs = objects.length
    var numPick = pickBuffers.length
    for(var i=0; i<numPick; ++i) {
      pickBufferCount[i] = 0
    }
    obj_loop:
    for(var i=0; i<numObjs; ++i) {
      var obj = objects[i]
      var pickCount = obj.pickSlots
      if(!pickCount) {
        pickBufferIds[i] = -1
        continue
      }
      for(var j=0; j<numPick; ++j) {
        if(pickBufferCount[j] + pickCount < 255) {
          pickBufferIds[i] = j
          obj.setPickBase(pickBufferCount[j]+1)
          pickBufferCount[j] += pickCount
          continue obj_loop
        }
      }
      //Create new pick buffer
      var nbuffer = createSelect(gl, viewShape)
      pickBufferIds[i] = numPick
      pickBuffers.push(nbuffer)
      pickBufferCount.push(pickCount)
      obj.setPickBase(1)
      numPick += 1
    }
    while(numPick > 0 && pickBufferCount[numPick-1] === 0) {
      pickBufferCount.pop()
      pickBuffers.pop().dispose()
    }
  }

  scene.update = function(options) {
    options = options || {}
    dirty = true
    pickDirty = true
  }

  scene.add = function(obj) {
    obj.axes = axes
    objects.push(obj)
    pickBufferIds.push(-1)
    dirty = true
    pickDirty = true
    reallocPickIds()
  }

  scene.remove = function(obj) {
    var idx = objects.indexOf(obj)
    if(idx < 0) {
      return
    }
    objects.splice(idx, 1)
    pickBufferIds.pop()
    dirty = true
    pickDirty = true
    reallocPickIds()
  }

  scene.dispose = function() {
    stopped = true
    window.removeEventListener('resize', resizeListener)
    axes.dispose()
    spikes.dispose()
    for(var i=0; i<objects.length; ++i) {
      objects[i].dispose()
    }
  }

  //Update mouse position
  var mouseRotating = false

  var prevButtons = 0

  mouseChange(canvas, function(buttons, x, y) {
    var numPick = pickBuffers.length
    var numObjs = objects.length
    var prevObj = selection.object
    selection.distance = Infinity
    selection.mouse[0] = x
    selection.mouse[1] = y
    selection.object = null
    selection.screen = null
    selection.dataCoordinate = selection.dataPosition = null

    var change = false

    if(buttons) {
      mouseRotating = true
    } else {
      if(mouseRotating) {
        pickDirty = true
      }
      mouseRotating = false

      for(var i=0; i<numPick; ++i) {
        var result = pickBuffers[i].query(x, pickShape[1] - y - 1, scene.pickRadius)
        if(result) {
          if(result.distance > selection.distance) {
            continue
          }
          for(var j=0; j<numObjs; ++j) {
            var obj = objects[j]
            if(pickBufferIds[j] !== i) {
              continue
            }
            var objPick = obj.pick(result)
            if(objPick) {
              selection.screen         = result.coord
              selection.distance       = result.distance
              selection.object         = obj
              selection.index          = objPick.distance
              selection.dataPosition   = objPick.position
              selection.dataCoordinate = objPick.dataCoordinate
              selection.data           = objPick
              change = true
            }
          }
        }
      }
    }
    if(prevObj && prevObj !== selection.object) {
      if(prevObj.highlight) {
        prevObj.highlight(null)
      }
      dirty = true
    }
    if(selection.object) {
      if(selection.object.highlight) {
        selection.object.highlight(selection.data)
      }
      dirty = true
    }

    change = change || (selection.object !== prevObj)
    if(change && scene.onselect) {
      scene.onselect(selection)
    }

    if((buttons & 1) && !(prevButtons & 1) && scene.onclick) {
      scene.onclick(selection)
    }
    prevButtons = buttons
  })

  //Render the scene for mouse picking
  function renderPick() {

    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)

    var numObjs = objects.length
    var numPick = pickBuffers.length
    for(var j=0; j<numPick; ++j) {
      var buf = pickBuffers[j]
      buf.shape = pickShape
      buf.begin()
      for(var i=0; i<numObjs; ++i) {
        if(pickBufferIds[i] !== j) {
          continue
        }
        var obj = objects[i]
        if(obj.drawPick) {
          obj.pixelRatio = 1
          obj.drawPick(cameraParams)
        }
      }
      buf.end()
    }
  }

  var nBounds = [
    [ Infinity, Infinity, Infinity],
    [-Infinity,-Infinity,-Infinity]]

  //Draw the whole scene
  function render() {
    if(stopped) {
      return
    }

    requestAnimationFrame(render)

    //Tick camera
    var cameraMoved = camera.tick()
    dirty     = dirty || cameraMoved
    pickDirty = pickDirty || cameraMoved

      //Set pixel ratio
    axes.pixelRatio   = scene.pixelRatio
    spikes.pixelRatio = scene.pixelRatio

    //Check if any objects changed, recalculate bounds
    var numObjs = objects.length
    var lo = nBounds[0]
    var hi = nBounds[1]
    lo[0] = lo[1] = lo[2] =  Infinity
    hi[0] = hi[1] = hi[2] = -Infinity
    for(var i=0; i<numObjs; ++i) {
      var obj = objects[i]

      //Set the axes properties for each object
      obj.pixelRatio = scene.pixelRatio
      obj.axes = scene.axes

      dirty = dirty || !!obj.dirty
      pickDirty = pickDirty || !!obj.dirty
      var obb = obj.bounds
      if(obb) {
        var olo = obb[0]
        var ohi = obb[1]
        for(var j=0; j<3; ++j) {
          lo[j] = Math.min(lo[j], olo[j])
          hi[j] = Math.max(hi[j], ohi[j])
        }
      }
    }

    //Recalculate bounds
    var bounds = scene.bounds
    if(scene.autoBounds) {
      var boundsChanged = false
      for(var j=0; j<3; ++j) {
        if(hi[j] < lo[j]) {
          lo[j] = -1
          hi[j] = 1
        } else {
          if(lo[j] === hi[j]) {
            lo[j] -= 1
            hi[j] = 1
          }
          var padding = 0.05 * (hi[j] - lo[j])
          lo[j] = lo[j] - padding
          hi[j] = hi[j] + padding
        }
        boundsChanged = boundsChanged ||
            (lo[j] !== bounds[0][j])  ||
            (hi[j] !== bounds[1][j])
      }
      if(boundsChanged) {
        var tickSpacing = [0,0,0]
        for(var i=0; i<3; ++i) {
          bounds[0][i] = lo[i]
          bounds[1][i] = hi[i]
          tickSpacing[i] = roundUpPow10((hi[i]-lo[i]) / 10.0)
        }
        if(axes.autoTicks) {
          axes.update({
            bounds: bounds,
            tickSpacing: tickSpacing
          })
        } else {
          axes.update({
            bounds: bounds
          })
        }
      }
    }

    //Recalculate bounds
    pickDirty = pickDirty || boundsChanged
    dirty = dirty || boundsChanged

    //Get scene
    var width  = gl.drawingBufferWidth
    var height = gl.drawingBufferHeight
    viewShape[0] = width
    viewShape[1] = height
    pickShape[0] = Math.max(width/scene.pixelRatio, 1)|0
    pickShape[1] = Math.max(height/scene.pixelRatio, 1)|0

    //Compute camera parameters
    perspective(projection,
      scene.fovy,
      width/height,
      scene.zNear,
      scene.zFar)

    //Compute model matrix
    for(var i=0; i<16; ++i) {
      model[i] = 0
    }
    model[15] = 1
    var diameter = 0
    for(var i=0; i<3; ++i) {
      diameter = Math.max(bounds[1][i] - bounds[0][i])
    }
    for(var i=0; i<3; ++i) {
      if(scene.autoScale) {
        model[5*i] = 0.5 / diameter
      } else {
        model[5*i] = 1
      }
      if(scene.autoCenter) {
        model[12+i] = -model[5*i] * 0.5 * (bounds[0][i] + bounds[1][i])
      }
    }

    //Apply axes/clip bounds
    for(var i=0; i<numObjs; ++i) {
      var obj = objects[i]

      //Set axes bounds
      obj.axesBounds = bounds

      //Set clip bounds
      if(scene.clipToBounds) {
        obj.clipBounds = bounds
      }
    }

    //Set spike parameters
    if(selection.object) {
      if(scene.snapToData) {
        spikes.position = selection.dataCoordinate
      } else {
        spikes.position = selection.dataPosition
      }
      spikes.bounds = bounds
    }

    //If state changed, then redraw pick buffers
    if(pickDirty) {
      pickDirty = false
      renderPick()
    }

    if(!dirty) {
      return
    }

    //Recalculate pixel data
    scene.axesPixels = axesRanges(scene.axes, cameraParams, width, height)

    //Call render callback
    if(scene.onrender) {
      scene.onrender()
    }

    //Read value
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)

    //General strategy: 3 steps
    //  1. render non-transparent objects
    //  2. accumulate transparent objects into separate fbo
    //  3. composite final scene

    //Clear FBO
    var clearColor = scene.clearColor
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3])
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.depthMask(true)
    gl.colorMask(true, true, true, true)  
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)  //most visualization surfaces are 2 sided

    //Render opaque pass
    var hasTransparent = false
    if(axes.enable) {
      hasTransparent = hasTransparent || axes.isTransparent()
      axes.draw(cameraParams)
    }
    spikes.axes = axes
    if(selection.object) {
      spikes.draw(cameraParams)
    }

    gl.disable(gl.CULL_FACE)  //most visualization surfaces are 2 sided
    
    for(var i=0; i<numObjs; ++i) {
      var obj = objects[i]
      obj.axes = axes
      obj.pixelRatio = scene.pixelRatio
      if(obj.isOpaque && obj.isOpaque()) {
        obj.draw(cameraParams)
      }
      if(obj.isTransparent && obj.isTransparent()) {
        hasTransparent = true
      }
    }

    if(hasTransparent) {
      //Render transparent pass
      accumBuffer.shape = viewShape
      accumBuffer.bind()
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.colorMask(false, false, false, false)
      gl.depthMask(true)
      gl.depthFunc(gl.LESS)
      
      //Render forward facing objects
      if(axes.enable && axes.isTransparent()) {
        axes.drawTransparent(cameraParams)
      }
      for(var i=0; i<numObjs; ++i) {
        var obj = objects[i]
        if(obj.isOpaque && obj.isOpaque()) {
          obj.draw(cameraParams)
        }
      }

      //Render transparent pass
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.colorMask(true, true, true, true)
      gl.depthMask(false)
      gl.clearColor(0,0,0,0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      if(axes.isTransparent()) {
        axes.drawTransparent(cameraParams)
      }

      for(var i=0; i<numObjs; ++i) {
        var obj = objects[i]
        if(obj.isTransparent && obj.isTransparent()) {
          obj.drawTransparent(cameraParams)
        }
      }

      //Unbind framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      //Draw composite pass
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.disable(gl.DEPTH_TEST)
      accumShader.bind()
      accumBuffer.color[0].bind(0)
      accumShader.uniforms.accumBuffer = 0
      drawTriangle(gl)

      //Turn off blending
      gl.disable(gl.BLEND)
    }

    //Clear dirty flags
    dirty = false
    for(var i=0; i<numObjs; ++i) {
      objects[i].dirty = false
    }
  }
  render()

  return scene
}
},{"./lib/shader":1,"a-big-triangle":20,"gl-axes3d":21,"gl-axes3d/properties":108,"gl-fbo":109,"gl-mat4/perspective":126,"gl-select-static":135,"gl-spikes3d":162,"mouse-change":171,"orbiter":182}],184:[function(require,module,exports){
var createShader = require("gl-shader");
var glslify = require("glslify");
var forward = require("glslify/simple-adapter.js")("\n#define GLSLIFY 1\n\nprecision mediump float;\nattribute vec4 uv;\nattribute vec2 f;\nattribute vec3 normal;\nuniform mat4 model, view, projection;\nuniform vec3 lightPosition, eyePosition;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  vec4 worldPosition = model * vec4(uv.zw, f.x, 1.0);\n  vec4 clipPosition = projection * view * worldPosition;\n  gl_Position = clipPosition;\n  value = f.x;\n  kill = f.y;\n  worldCoordinate = vec3(uv.zw, f.x);\n  planeCoordinate = uv.xy;\n  lightDirection = lightPosition - worldCoordinate;\n  eyeDirection = eyePosition - worldCoordinate;\n  surfaceNormal = normal;\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nfloat b_x_beckmannDistribution(float x, float roughness) {\n  float NdotH = max(x, 0.0001);\n  float cos2Alpha = NdotH * NdotH;\n  float tan2Alpha = (cos2Alpha - 1.0) / cos2Alpha;\n  float roughness2 = roughness * roughness;\n  float denom = 3.141592653589793 * roughness2 * cos2Alpha * cos2Alpha;\n  return exp(tan2Alpha / roughness2) / denom;\n}\nfloat a_x_cookTorranceSpecular(vec3 lightDirection, vec3 viewDirection, vec3 surfaceNormal, float roughness, float fresnel) {\n  float VdotN = max(dot(viewDirection, surfaceNormal), 0.0);\n  float LdotN = max(dot(lightDirection, surfaceNormal), 0.0);\n  vec3 H = normalize(lightDirection + viewDirection);\n  float NdotH = max(dot(surfaceNormal, H), 0.0);\n  float VdotH = max(dot(viewDirection, H), 0.000001);\n  float LdotH = max(dot(lightDirection, H), 0.000001);\n  float G1 = (2.0 * NdotH * VdotN) / VdotH;\n  float G2 = (2.0 * NdotH * LdotN) / LdotH;\n  float G = min(1.0, min(G1, G2));\n  float D = b_x_beckmannDistribution(NdotH, roughness);\n  float F = pow(1.0 - VdotN, fresnel);\n  return G * F * D / max(3.14159265 * VdotN, 0.000001);\n}\nuniform vec3 lowerBound, upperBound;\nuniform float contourTint;\nuniform vec4 contourColor;\nuniform sampler2D colormap;\nuniform vec3 clipBounds[2];\nuniform float roughness, fresnel, kambient, kdiffuse, kspecular, opacity;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  if(kill > 0.0 || any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {\n    discard;\n  }\n  vec3 N = normalize(surfaceNormal);\n  vec3 V = normalize(eyeDirection);\n  vec3 L = normalize(lightDirection);\n  if(gl_FrontFacing) {\n    N = -N;\n  }\n  float specular = a_x_cookTorranceSpecular(L, V, N, roughness, fresnel);\n  float diffuse = min(kambient + kdiffuse * max(dot(N, L), 0.0), 1.0);\n  float interpValue = (value - lowerBound.z) / (upperBound.z - lowerBound.z);\n  vec4 surfaceColor = texture2D(colormap, vec2(interpValue, interpValue));\n  vec4 litColor = surfaceColor.a * vec4(diffuse * surfaceColor.rgb + kspecular * vec3(1, 1, 1) * specular, 1.0);\n  gl_FragColor = mix(litColor, contourColor, contourTint) * opacity;\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"lightPosition","type":"vec3"},{"name":"eyePosition","type":"vec3"},{"name":"lowerBound","type":"vec3"},{"name":"upperBound","type":"vec3"},{"name":"contourTint","type":"float"},{"name":"contourColor","type":"vec4"},{"name":"colormap","type":"sampler2D"},{"name":"clipBounds[0]","type":"vec3"},{"name":"clipBounds[1]","type":"vec3"},{"name":"roughness","type":"float"},{"name":"fresnel","type":"float"},{"name":"kambient","type":"float"},{"name":"kdiffuse","type":"float"},{"name":"kspecular","type":"float"},{"name":"opacity","type":"float"}], [{"name":"uv","type":"vec4"},{"name":"f","type":"vec2"},{"name":"normal","type":"vec3"}]), contour = require("glslify/simple-adapter.js")("\n#define GLSLIFY 1\n\nprecision mediump float;\nattribute vec4 uv;\nuniform mat3 permutation;\nuniform mat4 model, view, projection;\nuniform float height, zOffset;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  vec3 dataCoordinate = permutation * vec3(uv.xy, height);\n  vec4 worldPosition = model * vec4(dataCoordinate, 1.0);\n  vec4 clipPosition = projection * view * worldPosition;\n  clipPosition.z = clipPosition.z + zOffset;\n  gl_Position = clipPosition;\n  value = height;\n  kill = -1.0;\n  worldCoordinate = dataCoordinate;\n  planeCoordinate = uv.zw;\n  surfaceNormal = vec3(1, 0, 0);\n  eyeDirection = vec3(0, 1, 0);\n  lightDirection = vec3(0, 0, 1);\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nfloat b_x_beckmannDistribution(float x, float roughness) {\n  float NdotH = max(x, 0.0001);\n  float cos2Alpha = NdotH * NdotH;\n  float tan2Alpha = (cos2Alpha - 1.0) / cos2Alpha;\n  float roughness2 = roughness * roughness;\n  float denom = 3.141592653589793 * roughness2 * cos2Alpha * cos2Alpha;\n  return exp(tan2Alpha / roughness2) / denom;\n}\nfloat a_x_cookTorranceSpecular(vec3 lightDirection, vec3 viewDirection, vec3 surfaceNormal, float roughness, float fresnel) {\n  float VdotN = max(dot(viewDirection, surfaceNormal), 0.0);\n  float LdotN = max(dot(lightDirection, surfaceNormal), 0.0);\n  vec3 H = normalize(lightDirection + viewDirection);\n  float NdotH = max(dot(surfaceNormal, H), 0.0);\n  float VdotH = max(dot(viewDirection, H), 0.000001);\n  float LdotH = max(dot(lightDirection, H), 0.000001);\n  float G1 = (2.0 * NdotH * VdotN) / VdotH;\n  float G2 = (2.0 * NdotH * LdotN) / LdotH;\n  float G = min(1.0, min(G1, G2));\n  float D = b_x_beckmannDistribution(NdotH, roughness);\n  float F = pow(1.0 - VdotN, fresnel);\n  return G * F * D / max(3.14159265 * VdotN, 0.000001);\n}\nuniform vec3 lowerBound, upperBound;\nuniform float contourTint;\nuniform vec4 contourColor;\nuniform sampler2D colormap;\nuniform vec3 clipBounds[2];\nuniform float roughness, fresnel, kambient, kdiffuse, kspecular, opacity;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  if(kill > 0.0 || any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {\n    discard;\n  }\n  vec3 N = normalize(surfaceNormal);\n  vec3 V = normalize(eyeDirection);\n  vec3 L = normalize(lightDirection);\n  if(gl_FrontFacing) {\n    N = -N;\n  }\n  float specular = a_x_cookTorranceSpecular(L, V, N, roughness, fresnel);\n  float diffuse = min(kambient + kdiffuse * max(dot(N, L), 0.0), 1.0);\n  float interpValue = (value - lowerBound.z) / (upperBound.z - lowerBound.z);\n  vec4 surfaceColor = texture2D(colormap, vec2(interpValue, interpValue));\n  vec4 litColor = surfaceColor.a * vec4(diffuse * surfaceColor.rgb + kspecular * vec3(1, 1, 1) * specular, 1.0);\n  gl_FragColor = mix(litColor, contourColor, contourTint) * opacity;\n}", [{"name":"permutation","type":"mat3"},{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"height","type":"float"},{"name":"zOffset","type":"float"},{"name":"lowerBound","type":"vec3"},{"name":"upperBound","type":"vec3"},{"name":"contourTint","type":"float"},{"name":"contourColor","type":"vec4"},{"name":"colormap","type":"sampler2D"},{"name":"clipBounds[0]","type":"vec3"},{"name":"clipBounds[1]","type":"vec3"},{"name":"roughness","type":"float"},{"name":"fresnel","type":"float"},{"name":"kambient","type":"float"},{"name":"kdiffuse","type":"float"},{"name":"kspecular","type":"float"},{"name":"opacity","type":"float"}], [{"name":"uv","type":"vec4"}]), pick = require("glslify/simple-adapter.js")("\n#define GLSLIFY 1\n\nprecision mediump float;\nattribute vec4 uv;\nattribute vec2 f;\nattribute vec3 normal;\nuniform mat4 model, view, projection;\nuniform vec3 lightPosition, eyePosition;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  vec4 worldPosition = model * vec4(uv.zw, f.x, 1.0);\n  vec4 clipPosition = projection * view * worldPosition;\n  gl_Position = clipPosition;\n  value = f.x;\n  kill = f.y;\n  worldCoordinate = vec3(uv.zw, f.x);\n  planeCoordinate = uv.xy;\n  lightDirection = lightPosition - worldCoordinate;\n  eyeDirection = eyePosition - worldCoordinate;\n  surfaceNormal = normal;\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform vec2 shape;\nuniform vec3 clipBounds[2];\nuniform float pickId;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 surfaceNormal;\nvec2 splitFloat(float v) {\n  float vh = 255.0 * v;\n  float upper = floor(vh);\n  float lower = fract(vh);\n  return vec2(upper / 255.0, floor(lower * 16.0) / 16.0);\n}\nvoid main() {\n  if(kill > 0.0 || any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {\n    discard;\n  }\n  vec2 ux = splitFloat(planeCoordinate.x / shape.x);\n  vec2 uy = splitFloat(planeCoordinate.y / shape.y);\n  gl_FragColor = vec4(pickId, ux.x, uy.x, ux.y + (uy.y / 16.0));\n}", [{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"lightPosition","type":"vec3"},{"name":"eyePosition","type":"vec3"},{"name":"shape","type":"vec2"},{"name":"clipBounds[0]","type":"vec3"},{"name":"clipBounds[1]","type":"vec3"},{"name":"pickId","type":"float"}], [{"name":"uv","type":"vec4"},{"name":"f","type":"vec2"},{"name":"normal","type":"vec3"}]), pickContour = require("glslify/simple-adapter.js")("\n#define GLSLIFY 1\n\nprecision mediump float;\nattribute vec4 uv;\nuniform mat3 permutation;\nuniform mat4 model, view, projection;\nuniform float height, zOffset;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 lightDirection, eyeDirection, surfaceNormal;\nvoid main() {\n  vec3 dataCoordinate = permutation * vec3(uv.xy, height);\n  vec4 worldPosition = model * vec4(dataCoordinate, 1.0);\n  vec4 clipPosition = projection * view * worldPosition;\n  clipPosition.z = clipPosition.z + zOffset;\n  gl_Position = clipPosition;\n  value = height;\n  kill = -1.0;\n  worldCoordinate = dataCoordinate;\n  planeCoordinate = uv.zw;\n  surfaceNormal = vec3(1, 0, 0);\n  eyeDirection = vec3(0, 1, 0);\n  lightDirection = vec3(0, 0, 1);\n}", "\n#define GLSLIFY 1\n\nprecision mediump float;\nuniform vec2 shape;\nuniform vec3 clipBounds[2];\nuniform float pickId;\nvarying float value, kill;\nvarying vec3 worldCoordinate;\nvarying vec2 planeCoordinate;\nvarying vec3 surfaceNormal;\nvec2 splitFloat(float v) {\n  float vh = 255.0 * v;\n  float upper = floor(vh);\n  float lower = fract(vh);\n  return vec2(upper / 255.0, floor(lower * 16.0) / 16.0);\n}\nvoid main() {\n  if(kill > 0.0 || any(lessThan(worldCoordinate, clipBounds[0])) || any(greaterThan(worldCoordinate, clipBounds[1]))) {\n    discard;\n  }\n  vec2 ux = splitFloat(planeCoordinate.x / shape.x);\n  vec2 uy = splitFloat(planeCoordinate.y / shape.y);\n  gl_FragColor = vec4(pickId, ux.x, uy.x, ux.y + (uy.y / 16.0));\n}", [{"name":"permutation","type":"mat3"},{"name":"model","type":"mat4"},{"name":"view","type":"mat4"},{"name":"projection","type":"mat4"},{"name":"height","type":"float"},{"name":"zOffset","type":"float"},{"name":"shape","type":"vec2"},{"name":"clipBounds[0]","type":"vec3"},{"name":"clipBounds[1]","type":"vec3"},{"name":"pickId","type":"float"}], [{"name":"uv","type":"vec4"}]);

exports.createShader = function(gl) {
    var shader = createShader(gl, forward);
    shader.attributes.uv.location = 0;
    shader.attributes.f.location = 1;
    shader.attributes.normal.location = 2;
    return shader;
};

exports.createPickShader = function(gl) {
    var shader = createShader(gl, pick);
    shader.attributes.uv.location = 0;
    shader.attributes.f.location = 1;
    shader.attributes.normal.location = 2;
    return shader;
};

exports.createContourShader = function(gl) {
    var shader = createShader(gl, contour);
    shader.attributes.uv.location = 0;
    return shader;
};

exports.createPickContourShader = function(gl) {
    var shader = createShader(gl, pickContour);
    shader.attributes.uv.location = 0;
    return shader;
};
},{"gl-shader":196,"glslify":214,"glslify/simple-adapter.js":215}],185:[function(require,module,exports){
arguments[4][67][0].apply(exports,arguments)
},{"dup":67}],186:[function(require,module,exports){
arguments[4][8][0].apply(exports,arguments)
},{"dup":8}],187:[function(require,module,exports){
module.exports={"jet":[{"index":0,"rgb":[0,0,131]},{"index":0.125,"rgb":[0,60,170]},{"index":0.375,"rgb":[5,255,255]},{"index":0.625,"rgb":[255,255,0]},{"index":0.875,"rgb":[250,0,0]},{"index":1,"rgb":[128,0,0]}],"hsv":[{"index":0,"rgb":[255,0,0]},{"index":0.169,"rgb":[253,255,2]},{"index":0.173,"rgb":[247,255,2]},{"index":0.337,"rgb":[0,252,4]},{"index":0.341,"rgb":[0,252,10]},{"index":0.506,"rgb":[1,249,255]},{"index":0.671,"rgb":[2,0,253]},{"index":0.675,"rgb":[8,0,253]},{"index":0.839,"rgb":[255,0,251]},{"index":0.843,"rgb":[255,0,245]},{"index":1,"rgb":[255,0,6]}],"hot":[{"index":0,"rgb":[0,0,0]},{"index":0.3,"rgb":[230,0,0]},{"index":0.6,"rgb":[255,210,0]},{"index":1,"rgb":[255,255,255]}],"cool":[{"index":0,"rgb":[0,255,255]},{"index":1,"rgb":[255,0,255]}],"spring":[{"index":0,"rgb":[255,0,255]},{"index":1,"rgb":[255,255,0]}],"summer":[{"index":0,"rgb":[0,128,102]},{"index":1,"rgb":[255,255,102]}],"autumn":[{"index":0,"rgb":[255,0,0]},{"index":1,"rgb":[255,255,0]}],"winter":[{"index":0,"rgb":[0,0,255]},{"index":1,"rgb":[0,255,128]}],"bone":[{"index":0,"rgb":[0,0,0]},{"index":0.376,"rgb":[84,84,116]},{"index":0.753,"rgb":[169,200,200]},{"index":1,"rgb":[255,255,255]}],"copper":[{"index":0,"rgb":[0,0,0]},{"index":0.804,"rgb":[255,160,102]},{"index":1,"rgb":[255,199,127]}],"greys":[{"index":0,"rgb":[0,0,0]},{"index":1,"rgb":[255,255,255]}],"yignbu":[{"index":0,"rgb":[8,29,88]},{"index":0.125,"rgb":[37,52,148]},{"index":0.25,"rgb":[34,94,168]},{"index":0.375,"rgb":[29,145,192]},{"index":0.5,"rgb":[65,182,196]},{"index":0.625,"rgb":[127,205,187]},{"index":0.75,"rgb":[199,233,180]},{"index":0.875,"rgb":[237,248,217]},{"index":1,"rgb":[255,255,217]}],"greens":[{"index":0,"rgb":[0,68,27]},{"index":0.125,"rgb":[0,109,44]},{"index":0.25,"rgb":[35,139,69]},{"index":0.375,"rgb":[65,171,93]},{"index":0.5,"rgb":[116,196,118]},{"index":0.625,"rgb":[161,217,155]},{"index":0.75,"rgb":[199,233,192]},{"index":0.875,"rgb":[229,245,224]},{"index":1,"rgb":[247,252,245]}],"yiorrd":[{"index":0,"rgb":[128,0,38]},{"index":0.125,"rgb":[189,0,38]},{"index":0.25,"rgb":[227,26,28]},{"index":0.375,"rgb":[252,78,42]},{"index":0.5,"rgb":[253,141,60]},{"index":0.625,"rgb":[254,178,76]},{"index":0.75,"rgb":[254,217,118]},{"index":0.875,"rgb":[255,237,160]},{"index":1,"rgb":[255,255,204]}],"bluered":[{"index":0,"rgb":[0,0,255]},{"index":1,"rgb":[255,0,0]}],"rdbu":[{"index":0,"rgb":[5,10,172]},{"index":0.35,"rgb":[106,137,247]},{"index":0.5,"rgb":[190,190,190]},{"index":0.6,"rgb":[220,170,132]},{"index":0.7,"rgb":[230,145,90]},{"index":1,"rgb":[178,10,28]}],"picnic":[{"index":0,"rgb":[0,0,255]},{"index":0.1,"rgb":[51,153,255]},{"index":0.2,"rgb":[102,204,255]},{"index":0.3,"rgb":[153,204,255]},{"index":0.4,"rgb":[204,204,255]},{"index":0.5,"rgb":[255,255,255]},{"index":0.6,"rgb":[255,204,255]},{"index":0.7,"rgb":[255,153,255]},{"index":0.8,"rgb":[255,102,204]},{"index":0.9,"rgb":[255,102,102]},{"index":1,"rgb":[255,0,0]}],"rainbow":[{"index":0,"rgb":[150,0,90]},{"index":0.125,"rgb":[0,0,200]},{"index":0.25,"rgb":[0,25,255]},{"index":0.375,"rgb":[0,152,255]},{"index":0.5,"rgb":[44,255,150]},{"index":0.625,"rgb":[151,255,0]},{"index":0.75,"rgb":[255,234,0]},{"index":0.875,"rgb":[255,111,0]},{"index":1,"rgb":[255,0,0]}],"portland":[{"index":0,"rgb":[12,51,131]},{"index":0.25,"rgb":[10,136,186]},{"index":0.5,"rgb":[242,211,56]},{"index":0.75,"rgb":[242,143,56]},{"index":1,"rgb":[217,30,30]}],"blackbody":[{"index":0,"rgb":[0,0,0]},{"index":0.2,"rgb":[230,0,0]},{"index":0.4,"rgb":[230,210,0]},{"index":0.7,"rgb":[255,255,255]},{"index":1,"rgb":[160,200,255]}],"earth":[{"index":0,"rgb":[0,0,130]},{"index":0.1,"rgb":[0,180,180]},{"index":0.2,"rgb":[40,210,40]},{"index":0.4,"rgb":[230,230,50]},{"index":0.6,"rgb":[120,70,20]},{"index":1,"rgb":[255,255,255]}],"electric":[{"index":0,"rgb":[0,0,0]},{"index":0.15,"rgb":[30,0,100]},{"index":0.4,"rgb":[120,0,100]},{"index":0.6,"rgb":[160,90,0]},{"index":0.8,"rgb":[230,200,0]},{"index":1,"rgb":[255,250,220]}], "alpha": [{"index":0, "rgb": [255,255,255,0]},{"index":0, "rgb": [255,255,255,1]}]}

},{}],188:[function(require,module,exports){
/*
 * Ben Postlethwaite
 * January 2013
 * License MIT
 */
'use strict';
var at = require('arraytools');
var colorScale = require('./colorScales.json');


module.exports = function (spec) {

  /*
   * Default Options
   */
    var indicies, rgba, fromrgba, torgba,
        nsteps, cmap, colormap, format,
        nshades, colors, alpha, index, i,
        r = [],
        g = [],
        b = [],
        a = [];

    if ( !at.isPlainObject(spec) ) spec = {};
    if (!spec.colormap) colormap = 'jet';
    if (!Array.isArray(spec.alpha)) {
        if (typeof spec.alpha === 'number') spec.alpha = [spec.alpha, spec.alpha];
        else spec.alpha = [1, 1];
    } else if (spec.alpha.length !== 2) spec.alpha = [1, 1];
    if (typeof spec.colormap === 'string') {
        colormap = spec.colormap.toLowerCase();

        if (!(colormap in colorScale)) {
            throw Error(colormap + ' not a supported colorscale');
        }
        cmap = colorScale[colormap];

    } else if (Array.isArray(spec.colormap)) {
        cmap = spec.colormap;
    }

    nshades = spec.nshades || 72;
    format = spec.format || 'hex';
    alpha = spec.alpha;

    if (cmap.length > nshades) {
        throw new Error(colormap +
                        ' map requires nshades to be at least size ' +
                        cmap.length);
    }

    /*
     * map index points from 0->1 to 0 -> n-1
     */
    indicies = cmap.map(function(c) {
        return Math.round(c.index * nshades);
    });

    /*
     * Add alpha channel to the map
     */
    if (alpha[0] < 0) alpha[0] = 0;
    if (alpha[1] < 0) alpha[0] = 0;
    if (alpha[0] > 1) alpha[0] = 1;
    if (alpha[1] > 1) alpha[0] = 1;

    for (i = 0; i < indicies.length; ++i) {
        index = cmap[i].index;
        rgba = cmap[i].rgb;
        // if user supplies their own map use theirs
        if (rgba.length === 4 && rgba[3] >= 0 && rgba[3] <= 1) continue;
        rgba[3] = alpha[0] + (alpha[1] - alpha[0])*index;
    }

    /*
     * map increasing linear values between indicies to
     * linear steps in colorvalues
     */
    for (i = 0; i < indicies.length-1; ++i) {
        nsteps = indicies[i+1] - indicies[i];
        fromrgba = cmap[i].rgb;
        torgba = cmap[i+1].rgb;
        r = r.concat(at.linspace(fromrgba[0], torgba[0], nsteps ) );
        g = g.concat(at.linspace(fromrgba[1], torgba[1], nsteps ) );
        b = b.concat(at.linspace(fromrgba[2], torgba[2], nsteps ) );
        a = a.concat(at.linspace(fromrgba[3], torgba[3], nsteps ) );
    }

    r = r.map( Math.round );
    g = g.map( Math.round );
    b = b.map( Math.round );

    colors = at.zip(r, g, b, a);

    if (format === 'hex') colors = colors.map( rgb2hex );
    if (format === 'rgbaString') colors = colors.map( rgbaStr );

    return colors;
};


function rgb2hex (rgba) {
    var dig, hex = '#';
    for (var i = 0; i < 3; ++i) {
        dig = rgba[i];
        dig = dig.toString(16);
        hex += ('00' + dig).substr( dig.length );
    }
    return hex;
}

function rgbaStr (rgba) {
    return 'rgba(' + rgba.join(',') + ')';
}

},{"./colorScales.json":187,"arraytools":189}],189:[function(require,module,exports){
'use strict';

var arraytools  = function () {

  var that = {};

  var RGB_REGEX =  /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,.*)?\)$/;
  var RGB_GROUP_REGEX = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,?\s*(.*)?\)$/;

  function isPlainObject (v) {
    return !Array.isArray(v) && v !== null && typeof v === 'object';
  }

  function linspace (start, end, num) {
    var inc = (end - start) / (num - 1);
    var a = [];
    for( var ii = 0; ii < num; ii++)
      a.push(start + ii*inc);
    return a;
  }

  function zip () {
      var arrays = [].slice.call(arguments);
      var lengths = arrays.map(function (a) {return a.length;});
      var len = Math.min.apply(null, lengths);
      var zipped = [];
      for (var i = 0; i < len; i++) {
          zipped[i] = [];
          for (var j = 0; j < arrays.length; ++j) {
              zipped[i][j] = arrays[j][i];
          }
      }
      return zipped;
  }

  function zip3 (a, b, c) {
      var len = Math.min.apply(null, [a.length, b.length, c.length]);
      var result = [];
      for (var n = 0; n < len; n++) {
          result.push([a[n], b[n], c[n]]);
      }
      return result;
  }

  function sum (A) {
    var acc = 0;
    accumulate(A, acc);
    function accumulate(x) {
      for (var i = 0; i < x.length; i++) {
        if (Array.isArray(x[i]))
          accumulate(x[i], acc);
        else
          acc += x[i];
      }
    }
    return acc;
  }

  function copy2D (arr) {
    var carr = [];
    for (var i = 0; i < arr.length; ++i) {
      carr[i] = [];
      for (var j = 0; j < arr[i].length; ++j) {
        carr[i][j] = arr[i][j];
      }
    }

    return carr;
  }


  function copy1D (arr) {
    var carr = [];
    for (var i = 0; i < arr.length; ++i) {
      carr[i] = arr[i];
    }

    return carr;
  }


  function isEqual(arr1, arr2) {
    if(arr1.length !== arr2.length)
      return false;
    for(var i = arr1.length; i--;) {
      if(arr1[i] !== arr2[i])
        return false;
    }

    return true;
  }


  function str2RgbArray(str, twoFiftySix) {
    // convert hex or rbg strings to 0->1 or 0->255 rgb array
    var rgb,
        match;

    if (typeof str !== 'string') return str;

    rgb = [];
    // hex notation
    if (str[0] === '#') {
      str = str.substr(1) // remove hash
      if (str.length === 3) str += str // fff -> ffffff
      match = parseInt(str, 16);
      rgb[0] = ((match >> 16) & 255);
      rgb[1] = ((match >> 8) & 255);
      rgb[2] = (match & 255);
    }

    // rgb(34, 34, 127) or rgba(34, 34, 127, 0.1) notation
    else if (RGB_REGEX.test(str)) {
      match = str.match(RGB_GROUP_REGEX);
      rgb[0] = parseInt(match[1]);
      rgb[1] = parseInt(match[2]);
      rgb[2] = parseInt(match[3]);
    }

    if (!twoFiftySix) {
      for (var j=0; j<3; ++j) rgb[j] = rgb[j]/255
    }


    return rgb;
  }


  function str2RgbaArray(str, twoFiftySix) {
    // convert hex or rbg strings to 0->1 or 0->255 rgb array
    var rgb,
        match;

    if (typeof str !== 'string') return str;

    rgb = [];
    // hex notation
    if (str[0] === '#') {
      str = str.substr(1) // remove hash
      if (str.length === 3) str += str // fff -> ffffff
      match = parseInt(str, 16);
      rgb[0] = ((match >> 16) & 255);
      rgb[1] = ((match >> 8) & 255);
      rgb[2] = (match & 255);
    }

    // rgb(34, 34, 127) or rgba(34, 34, 127, 0.1) notation
    else if (RGB_REGEX.test(str)) {
      match = str.match(RGB_GROUP_REGEX);
      rgb[0] = parseInt(match[1]);
      rgb[1] = parseInt(match[2]);
      rgb[2] = parseInt(match[3]);
      if (match[4]) rgb[3] = parseFloat(match[4]);
      else rgb[3] = 1.0;
    }



    if (!twoFiftySix) {
      for (var j=0; j<3; ++j) rgb[j] = rgb[j]/255
    }


    return rgb;
  }





  that.isPlainObject = isPlainObject;
  that.linspace = linspace;
  that.zip3 = zip3;
  that.sum = sum;
  that.zip = zip;
  that.isEqual = isEqual;
  that.copy2D = copy2D;
  that.copy1D = copy1D;
  that.str2RgbArray = str2RgbArray;
  that.str2RgbaArray = str2RgbaArray;

  return that

}


module.exports = arraytools();

},{}],190:[function(require,module,exports){
arguments[4][9][0].apply(exports,arguments)
},{"dup":9}],191:[function(require,module,exports){
arguments[4][2][0].apply(exports,arguments)
},{"dup":2,"ndarray":247,"ndarray-ops":221,"typedarray-pool":245,"webglew":193}],192:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],193:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":192}],194:[function(require,module,exports){
arguments[4][123][0].apply(exports,arguments)
},{"dup":123}],195:[function(require,module,exports){
arguments[4][125][0].apply(exports,arguments)
},{"dup":125}],196:[function(require,module,exports){
arguments[4][136][0].apply(exports,arguments)
},{"./lib/create-attributes":197,"./lib/create-uniforms":198,"./lib/reflect":199,"./lib/runtime-reflect":200,"./lib/shader-cache":201,"dup":136}],197:[function(require,module,exports){
arguments[4][137][0].apply(exports,arguments)
},{"dup":137}],198:[function(require,module,exports){
arguments[4][138][0].apply(exports,arguments)
},{"./reflect":199,"dup":138}],199:[function(require,module,exports){
arguments[4][139][0].apply(exports,arguments)
},{"dup":139}],200:[function(require,module,exports){
arguments[4][140][0].apply(exports,arguments)
},{"dup":140}],201:[function(require,module,exports){
arguments[4][141][0].apply(exports,arguments)
},{"dup":141,"weakmap-shim":204}],202:[function(require,module,exports){
arguments[4][142][0].apply(exports,arguments)
},{"./hidden-store.js":203,"dup":142}],203:[function(require,module,exports){
arguments[4][143][0].apply(exports,arguments)
},{"dup":143}],204:[function(require,module,exports){
arguments[4][144][0].apply(exports,arguments)
},{"./create-store.js":202,"dup":144}],205:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],206:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":205}],207:[function(require,module,exports){
arguments[4][118][0].apply(exports,arguments)
},{"dup":118,"ndarray":247,"ndarray-ops":221,"typedarray-pool":245,"webglew":206}],208:[function(require,module,exports){
arguments[4][13][0].apply(exports,arguments)
},{"dup":13}],209:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"./do-bind.js":208,"dup":14}],210:[function(require,module,exports){
arguments[4][15][0].apply(exports,arguments)
},{"./do-bind.js":208,"dup":15}],211:[function(require,module,exports){
arguments[4][11][0].apply(exports,arguments)
},{"dup":11}],212:[function(require,module,exports){
arguments[4][12][0].apply(exports,arguments)
},{"dup":12,"weak-map":211}],213:[function(require,module,exports){
arguments[4][18][0].apply(exports,arguments)
},{"./lib/vao-emulated.js":209,"./lib/vao-native.js":210,"dup":18,"webglew":212}],214:[function(require,module,exports){
arguments[4][164][0].apply(exports,arguments)
},{"dup":164}],215:[function(require,module,exports){
arguments[4][170][0].apply(exports,arguments)
},{"dup":170}],216:[function(require,module,exports){
'use strict'

module.exports      = gradient

var dup             = require('dup')
var cwiseCompiler   = require('cwise-compiler')

var TEMPLATE_CACHE  = {}
var GRADIENT_CACHE  = {}

var EmptyProc = {
  body: "",
  args: [],
  thisVars: [],
  localVars: []
}

var centralDiff = cwiseCompiler({
  args: [ 'array', 'array', 'array' ],
  pre: EmptyProc,
  post: EmptyProc,
  body: {
    args: [ {
      name: 'out', 
      lvalue: true,
      rvalue: false,
      count: 1
    }, {
      name: 'left', 
      lvalue: false,
      rvalue: true,
      count: 1
    }, {
      name: 'right', 
      lvalue: false,
      rvalue: true,
      count: 1
    }],
    body: "out=0.5*(left-right)",
    thisVars: [],
    localVars: []
  },
  funcName: 'cdiff'
})

var zeroOut = cwiseCompiler({
  args: [ 'array' ],
  pre: EmptyProc,
  post: EmptyProc,
  body: {
    args: [ {
      name: 'out', 
      lvalue: true,
      rvalue: false,
      count: 1
    }],
    body: "out=0",
    thisVars: [],
    localVars: []
  },
  funcName: 'zero'
})

function generateTemplate(d) {
  if(d in TEMPLATE_CACHE) {
    return TEMPLATE_CACHE[d]
  }
  var code = []
  for(var i=0; i<d; ++i) {
    code.push('out', i, 's=0.5*(inp', i, 'l-inp', i, 'r);')
  }
  var args = [ 'array' ]
  var names = ['junk']
  for(var i=0; i<d; ++i) {
    args.push('array')
    names.push('out' + i + 's')
    var o = dup(d)
    o[i] = -1
    args.push({
      array: 0,
      offset: o.slice()
    })
    o[i] = 1
    args.push({
      array: 0,
      offset: o.slice()
    })
    names.push('inp' + i + 'l', 'inp' + i + 'r')
  }
  return TEMPLATE_CACHE[d] = cwiseCompiler({
    args: args,
    pre:  EmptyProc,
    post: EmptyProc,
    body: {
      body: code.join(''),
      args: names.map(function(n) {
        return {
          name: n,
          lvalue: n.indexOf('out') === 0,
          rvalue: n.indexOf('inp') === 0,
          count: (n!=='junk')|0
        }
      }),
      thisVars: [],
      localVars: []
    },
    funcName: 'fdTemplate' + d
  })
}

function generateGradient(boundaryConditions) {
  var token = boundaryConditions.join()
  var proc = GRADIENT_CACHE[token]
  if(proc) {
    return proc
  }

  var d = boundaryConditions.length
  var code = ['function gradient(dst,src){var s=src.shape.slice();' ]
  
  function handleBoundary(facet) {
    var cod = d - facet.length

    var loStr = []
    var hiStr = []
    var pickStr = []
    for(var i=0; i<d; ++i) {
      if(facet.indexOf(i+1) >= 0) {
        pickStr.push('0')
      } else if(facet.indexOf(-(i+1)) >= 0) {
        pickStr.push('s['+i+']-1')
      } else {
        pickStr.push('-1')
        loStr.push('1')
        hiStr.push('s['+i+']-2')
      }
    }
    var boundStr = '.lo(' + loStr.join() + ').hi(' + hiStr.join() + ')'
    if(loStr.length === 0) {
      boundStr = ''
    }
        
    if(cod > 0) {
      code.push('if(1') 
      for(var i=0; i<d; ++i) {
        if(facet.indexOf(i+1) >= 0 || facet.indexOf(-(i+1)) >= 0) {
          continue
        }
        code.push('&&s[', i, ']>2')
      }
      code.push('){grad', cod, '(src.pick(', pickStr.join(), ')', boundStr)
      for(var i=0; i<d; ++i) {
        if(facet.indexOf(i+1) >= 0 || facet.indexOf(-(i+1)) >= 0) {
          continue
        }
        code.push(',dst.pick(', pickStr.join(), ',', i, ')', boundStr)
      }
      code.push(');')
    }

    for(var i=0; i<facet.length; ++i) {
      var bnd = Math.abs(facet[i])-1
      var outStr = 'dst.pick(' + pickStr.join() + ',' + bnd + ')' + boundStr
      switch(boundaryConditions[bnd]) {

        case 'clamp':
          var cPickStr = pickStr.slice()
          var dPickStr = pickStr.slice()
          if(facet[i] < 0) {
            cPickStr[bnd] = 's[' + bnd + ']-2'
          } else {
            dPickStr[bnd] = '1'
          }
          if(cod === 0) {
            code.push('if(s[', bnd, ']>1){dst.set(',
              pickStr.join(), ',', bnd, ',0.5*(src.get(',
                cPickStr.join(), ')-src.get(',
                dPickStr.join(), ')))}else{dst.set(',
              pickStr.join(), ',', bnd, ',0)};')
          } else {
            code.push('if(s[', bnd, ']>1){diff(', outStr, 
                ',src.pick(', cPickStr.join(), ')', boundStr, 
                ',src.pick(', dPickStr.join(), ')', boundStr, 
                ');}else{zero(', outStr, ');};')
          }
        break

        case 'mirror':
          if(cod === 0) {
            code.push('dst.set(', pickStr.join(), ',', bnd, ',0);')
          } else {
            code.push('zero(', outStr, ');')
          }
        break

        case 'wrap':
          var aPickStr = pickStr.slice()
          var bPickStr = pickStr.slice()
          if(facet[i] < 0) {
            aPickStr[bnd] = 's[' + bnd + ']-2'
            bPickStr[bnd] = '0'
            
          } else {
            aPickStr[bnd] = 's[' + bnd + ']-1'
            bPickStr[bnd] = '1'
          }
          if(cod === 0) {
            code.push('if(s[', bnd, ']>2){dst.set(',
              pickStr.join(), ',', bnd, ',0.5*(src.get(',
                aPickStr.join(), ')-src.get(',
                bPickStr.join(), ')))}else{dst.set(',
              pickStr.join(), ',', bnd, ',0)};')
          } else {
            code.push('if(s[', bnd, ']>2){diff(', outStr, 
                ',src.pick(', aPickStr.join(), ')', boundStr, 
                ',src.pick(', bPickStr.join(), ')', boundStr, 
                ');}else{zero(', outStr, ');};')
          }
        break

        default:
          throw new Error('ndarray-gradient: Invalid boundary condition')
      }
    }

    if(cod > 0) {
      code.push('};')
    }
  }

  //Enumerate ridges, facets, etc. of hypercube
  for(var i=0; i<(1<<d); ++i) {
    var faces = []
    for(var j=0; j<d; ++j) {
      if(i & (1<<j)) {
        faces.push(j+1)
      }
    }
    for(var k=0; k<(1<<faces.length); ++k) {
      var sfaces = faces.slice()
      for(var j=0; j<faces.length; ++j) {
        if(k & (1<<j)) {
          sfaces[j] = -sfaces[j]
        }
      }
      handleBoundary(sfaces)
    }
  }

  code.push('return dst;};return gradient')

  //Compile and link routine, save cached procedure
  var linkNames = [ 'diff', 'zero' ]
  var linkArgs  = [ centralDiff, zeroOut ]
  for(var i=1; i<=d; ++i) {
    linkNames.push('grad' + i)
    linkArgs.push(generateTemplate(i))
  }
  linkNames.push(code.join(''))

  var link = Function.apply(void 0, linkNames)
  var proc = link.apply(void 0, linkArgs)
  TEMPLATE_CACHE[token] = proc
  return proc
}

function gradient(out, inp, bc) {
  if(Array.isArray(bc)) {
    if(bc.length !== inp.dimension) {
      throw new Error('ndarray-gradient: invalid boundary conditions')
    }
  } else if(typeof bc === 'string') {
    bc = dup(inp.dimension, bc)
  } else {
    bc = dup(inp.dimension, 'clamp')
  }
  if(out.dimension !== inp.dimension + 1) {
    throw new Error('ndarray-gradient: output dimension must be +1 input dimension')
  }
  if(out.shape[inp.dimension] !== inp.dimension) {
    throw new Error('ndarray-gradient: output shape must match input shape')
  }
  for(var i=0; i<inp.dimension; ++i) {
    if(out.shape[i] !== inp.shape[i]) {
      throw new Error('ndarray-gradient: shape mismatch')
    }
  }
  if(inp.size === 0) {
    return out
  }
  if(inp.dimension <= 0) {
    out.set(0)
    return out
  }
  var cached = generateGradient(bc)
  return cached(out, inp)
}
},{"cwise-compiler":217,"dup":190}],217:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":219,"dup":4}],218:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":220}],219:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":218,"dup":6}],220:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],221:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"cwise-compiler":222,"dup":3}],222:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":224,"dup":4}],223:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":225}],224:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":223,"dup":6}],225:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],226:[function(require,module,exports){
"use strict"

var ndarray = require("ndarray")
var do_convert = require("./doConvert.js")

module.exports = function convert(arr, result) {
  var shape = [], c = arr, sz = 1
  while(c instanceof Array) {
    shape.push(c.length)
    sz *= c.length
    c = c[0]
  }
  if(shape.length === 0) {
    return ndarray()
  }
  if(!result) {
    result = ndarray(new Float64Array(sz), shape)
  }
  do_convert(result, arr)
  return result
}

},{"./doConvert.js":227,"ndarray":247}],227:[function(require,module,exports){
module.exports=require('cwise-compiler')({"args":["array","scalar","index"],"pre":{"body":"{}","args":[],"thisVars":[],"localVars":[]},"body":{"body":"{\nvar _inline_1_v=_inline_1_arg1_,_inline_1_i\nfor(_inline_1_i=0;_inline_1_i<_inline_1_arg2_.length-1;++_inline_1_i) {\n_inline_1_v=_inline_1_v[_inline_1_arg2_[_inline_1_i]]\n}\n_inline_1_arg0_=_inline_1_v[_inline_1_arg2_[_inline_1_arg2_.length-1]]\n}","args":[{"name":"_inline_1_arg0_","lvalue":true,"rvalue":false,"count":1},{"name":"_inline_1_arg1_","lvalue":false,"rvalue":true,"count":1},{"name":"_inline_1_arg2_","lvalue":false,"rvalue":true,"count":4}],"thisVars":[],"localVars":["_inline_1_i","_inline_1_v"]},"post":{"body":"{}","args":[],"thisVars":[],"localVars":[]},"funcName":"convert","blockSize":64})

},{"cwise-compiler":228}],228:[function(require,module,exports){
"use strict"

var createThunk = require("./lib/thunk.js")

function Procedure() {
  this.argTypes = []
  this.shimArgs = []
  this.arrayArgs = []
  this.scalarArgs = []
  this.offsetArgs = []
  this.offsetArgIndex = []
  this.indexArgs = []
  this.shapeArgs = []
  this.funcName = ""
  this.pre = null
  this.body = null
  this.post = null
  this.debug = false
}

function compileCwise(user_args) {
  //Create procedure
  var proc = new Procedure()
  
  //Parse blocks
  proc.pre    = user_args.pre
  proc.body   = user_args.body
  proc.post   = user_args.post

  //Parse arguments
  var proc_args = user_args.args.slice(0)
  proc.argTypes = proc_args.slice(0)
  for(var i=0; i<proc_args.length; ++i) {
    var arg_type = proc_args[i]
    if(arg_type === "array") {
      proc.arrayArgs.push(i)
      proc.shimArgs.push("array" + i)
      if(i < proc.pre.args.length && proc.pre.args[i].count>0) {
        throw new Error("cwise: pre() block may not reference array args")
      }
      if(i < proc.post.args.length && proc.post.args[i].count>0) {
        throw new Error("cwise: post() block may not reference array args")
      }
    } else if(arg_type === "scalar") {
      proc.scalarArgs.push(i)
      proc.shimArgs.push("scalar" + i)
    } else if(arg_type === "index") {
      proc.indexArgs.push(i)
      if(i < proc.pre.args.length && proc.pre.args[i].count > 0) {
        throw new Error("cwise: pre() block may not reference array index")
      }
      if(i < proc.body.args.length && proc.body.args[i].lvalue) {
        throw new Error("cwise: body() block may not write to array index")
      }
      if(i < proc.post.args.length && proc.post.args[i].count > 0) {
        throw new Error("cwise: post() block may not reference array index")
      }
    } else if(arg_type === "shape") {
      proc.shapeArgs.push(i)
      if(i < proc.pre.args.length && proc.pre.args[i].lvalue) {
        throw new Error("cwise: pre() block may not write to array shape")
      }
      if(i < proc.body.args.length && proc.body.args[i].lvalue) {
        throw new Error("cwise: body() block may not write to array shape")
      }
      if(i < proc.post.args.length && proc.post.args[i].lvalue) {
        throw new Error("cwise: post() block may not write to array shape")
      }
    } else if(typeof arg_type === "object" && arg_type.offset) {
      proc.argTypes[i] = "offset"
      proc.offsetArgs.push({ array: arg_type.array, offset:arg_type.offset })
      proc.offsetArgIndex.push(i)
    } else {
      throw new Error("cwise: Unknown argument type " + proc_args[i])
    }
  }
  
  //Make sure at least one array argument was specified
  if(proc.arrayArgs.length <= 0) {
    throw new Error("cwise: No array arguments specified")
  }
  
  //Make sure arguments are correct
  if(proc.pre.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in pre() block")
  }
  if(proc.body.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in body() block")
  }
  if(proc.post.args.length > proc_args.length) {
    throw new Error("cwise: Too many arguments in post() block")
  }

  //Check debug flag
  proc.debug = !!user_args.printCode || !!user_args.debug
  
  //Retrieve name
  proc.funcName = user_args.funcName || "cwise"
  
  //Read in block size
  proc.blockSize = user_args.blockSize || 64

  return createThunk(proc)
}

module.exports = compileCwise

},{"./lib/thunk.js":230}],229:[function(require,module,exports){
"use strict"

var uniq = require("uniq")

function innerFill(order, proc, body) {
  var dimension = order.length
    , nargs = proc.arrayArgs.length
    , has_index = proc.indexArgs.length>0
    , code = []
    , vars = []
    , idx=0, pidx=0, i, j
  for(i=0; i<dimension; ++i) {
    vars.push(["i",i,"=0"].join(""))
  }
  //Compute scan deltas
  for(j=0; j<nargs; ++j) {
    for(i=0; i<dimension; ++i) {
      pidx = idx
      idx = order[i]
      if(i === 0) {
        vars.push(["d",j,"s",i,"=t",j,"[",idx,"]"].join(""))
      } else {
        vars.push(["d",j,"s",i,"=(t",j,"[",idx,"]-s",pidx,"*t",j,"[",pidx,"])"].join(""))
      }
    }
  }
  code.push("var " + vars.join(","))
  //Scan loop
  for(i=dimension-1; i>=0; --i) {
    idx = order[i]
    code.push(["for(i",i,"=0;i",i,"<s",idx,";++i",i,"){"].join(""))
  }
  //Push body of inner loop
  code.push(body)
  //Advance scan pointers
  for(i=0; i<dimension; ++i) {
    pidx = idx
    idx = order[i]
    for(j=0; j<nargs; ++j) {
      code.push(["p",j,"+=d",j,"s",i].join(""))
    }
    if(has_index) {
      if(i > 0) {
        code.push(["index[",pidx,"]-=s",pidx].join(""))
      }
      code.push(["++index[",idx,"]"].join(""))
    }
    code.push("}")
  }
  return code.join("\n")
}

function outerFill(matched, order, proc, body) {
  var dimension = order.length
    , nargs = proc.arrayArgs.length
    , blockSize = proc.blockSize
    , has_index = proc.indexArgs.length > 0
    , code = []
  for(var i=0; i<nargs; ++i) {
    code.push(["var offset",i,"=p",i].join(""))
  }
  //Generate matched loops
  for(var i=matched; i<dimension; ++i) {
    code.push(["for(var j"+i+"=SS[", order[i], "]|0;j", i, ">0;){"].join(""))
    code.push(["if(j",i,"<",blockSize,"){"].join(""))
    code.push(["s",order[i],"=j",i].join(""))
    code.push(["j",i,"=0"].join(""))
    code.push(["}else{s",order[i],"=",blockSize].join(""))
    code.push(["j",i,"-=",blockSize,"}"].join(""))
    if(has_index) {
      code.push(["index[",order[i],"]=j",i].join(""))
    }
  }
  for(var i=0; i<nargs; ++i) {
    var indexStr = ["offset"+i]
    for(var j=matched; j<dimension; ++j) {
      indexStr.push(["j",j,"*t",i,"[",order[j],"]"].join(""))
    }
    code.push(["p",i,"=(",indexStr.join("+"),")"].join(""))
  }
  code.push(innerFill(order, proc, body))
  for(var i=matched; i<dimension; ++i) {
    code.push("}")
  }
  return code.join("\n")
}

//Count the number of compatible inner orders
function countMatches(orders) {
  var matched = 0, dimension = orders[0].length
  while(matched < dimension) {
    for(var j=1; j<orders.length; ++j) {
      if(orders[j][matched] !== orders[0][matched]) {
        return matched
      }
    }
    ++matched
  }
  return matched
}

//Processes a block according to the given data types
function processBlock(block, proc, dtypes) {
  var code = block.body
  var pre = []
  var post = []
  for(var i=0; i<block.args.length; ++i) {
    var carg = block.args[i]
    if(carg.count <= 0) {
      continue
    }
    var re = new RegExp(carg.name, "g")
    var ptrStr = ""
    var arrNum = proc.arrayArgs.indexOf(i)
    switch(proc.argTypes[i]) {
      case "offset":
        var offArgIndex = proc.offsetArgIndex.indexOf(i)
        var offArg = proc.offsetArgs[offArgIndex]
        arrNum = offArg.array
        ptrStr = "+q" + offArgIndex
      case "array":
        ptrStr = "p" + arrNum + ptrStr
        var localStr = "l" + i
        var arrStr = "a" + arrNum
        if(carg.count === 1) {
          if(dtypes[arrNum] === "generic") {
            if(carg.lvalue) {
              pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join(""))
              code = code.replace(re, localStr)
              post.push([arrStr, ".set(", ptrStr, ",", localStr,")"].join(""))
            } else {
              code = code.replace(re, [arrStr, ".get(", ptrStr, ")"].join(""))
            }
          } else {
            code = code.replace(re, [arrStr, "[", ptrStr, "]"].join(""))
          }
        } else if(dtypes[arrNum] === "generic") {
          pre.push(["var ", localStr, "=", arrStr, ".get(", ptrStr, ")"].join(""))
          code = code.replace(re, localStr)
          if(carg.lvalue) {
            post.push([arrStr, ".set(", ptrStr, ",", localStr,")"].join(""))
          }
        } else {
          pre.push(["var ", localStr, "=", arrStr, "[", ptrStr, "]"].join(""))
          code = code.replace(re, localStr)
          if(carg.lvalue) {
            post.push([arrStr, "[", ptrStr, "]=", localStr].join(""))
          }
        }
      break
      case "scalar":
        code = code.replace(re, "Y" + proc.scalarArgs.indexOf(i))
      break
      case "index":
        code = code.replace(re, "index")
      break
      case "shape":
        code = code.replace(re, "shape")
      break
    }
  }
  return [pre.join("\n"), code, post.join("\n")].join("\n").trim()
}

function typeSummary(dtypes) {
  var summary = new Array(dtypes.length)
  var allEqual = true
  for(var i=0; i<dtypes.length; ++i) {
    var t = dtypes[i]
    var digits = t.match(/\d+/)
    if(!digits) {
      digits = ""
    } else {
      digits = digits[0]
    }
    if(t.charAt(0) === 0) {
      summary[i] = "u" + t.charAt(1) + digits
    } else {
      summary[i] = t.charAt(0) + digits
    }
    if(i > 0) {
      allEqual = allEqual && summary[i] === summary[i-1]
    }
  }
  if(allEqual) {
    return summary[0]
  }
  return summary.join("")
}

//Generates a cwise operator
function generateCWiseOp(proc, typesig) {

  //Compute dimension
  var dimension = typesig[1].length|0
  var orders = new Array(proc.arrayArgs.length)
  var dtypes = new Array(proc.arrayArgs.length)

  //First create arguments for procedure
  var arglist = ["SS"]
  var code = ["'use strict'"]
  var vars = []
  
  for(var j=0; j<dimension; ++j) {
    vars.push(["s", j, "=SS[", j, "]"].join(""))
  }
  for(var i=0; i<proc.arrayArgs.length; ++i) {
    arglist.push("a"+i)
    arglist.push("t"+i)
    arglist.push("p"+i)
    dtypes[i] = typesig[2*i]
    orders[i] = typesig[2*i+1]
  }
  for(var i=0; i<proc.scalarArgs.length; ++i) {
    arglist.push("Y" + i)
  }
  if(proc.shapeArgs.length > 0) {
    vars.push("shape=SS.slice(0)")
  }
  if(proc.indexArgs.length > 0) {
    var zeros = new Array(dimension)
    for(var i=0; i<dimension; ++i) {
      zeros[i] = "0"
    }
    vars.push(["index=[", zeros.join(","), "]"].join(""))
  }
  for(var i=0; i<proc.offsetArgs.length; ++i) {
    var off_arg = proc.offsetArgs[i]
    var init_string = []
    for(var j=0; j<off_arg.offset.length; ++j) {
      if(off_arg.offset[j] === 0) {
        continue
      } else if(off_arg.offset[j] === 1) {
        init_string.push(["t", off_arg.array, "[", j, "]"].join(""))      
      } else {
        init_string.push([off_arg.offset[j], "*t", off_arg.array, "[", j, "]"].join(""))
      }
    }
    if(init_string.length === 0) {
      vars.push("q" + i + "=0")
    } else {
      vars.push(["q", i, "=(", init_string.join("+"),")|0"].join(""))
    }
  }

  //Prepare this variables
  var thisVars = uniq([].concat(proc.pre.thisVars)
                      .concat(proc.body.thisVars)
                      .concat(proc.post.thisVars))
  vars = vars.concat(thisVars)
  code.push("var " + vars.join(","))
  for(var i=0; i<proc.arrayArgs.length; ++i) {
    code.push("p"+i+"|=0")
  }
  
  //Inline prelude
  if(proc.pre.body.length > 3) {
    code.push(processBlock(proc.pre, proc, dtypes))
  }

  //Process body
  var body = processBlock(proc.body, proc, dtypes)
  var matched = countMatches(orders)
  if(matched < dimension) {
    code.push(outerFill(matched, orders[0], proc, body))
  } else {
    code.push(innerFill(orders[0], proc, body))
  }

  //Inline epilog
  if(proc.post.body.length > 3) {
    code.push(processBlock(proc.post, proc, dtypes))
  }
  
  if(proc.debug) {
    console.log("Generated cwise routine for ", typesig, ":\n\n", code.join("\n"))
  }
  
  var loopName = [(proc.funcName||"unnamed"), "_cwise_loop_", orders[0].join("s"),"m",matched,typeSummary(dtypes)].join("")
  var f = new Function(["function ",loopName,"(", arglist.join(","),"){", code.join("\n"),"} return ", loopName].join(""))
  return f()
}
module.exports = generateCWiseOp
},{"uniq":231}],230:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":229,"dup":6}],231:[function(require,module,exports){
"use strict"

function unique_pred(list, compare) {
  var ptr = 1
    , len = list.length
    , a=list[0], b=list[0]
  for(var i=1; i<len; ++i) {
    b = a
    a = list[i]
    if(compare(a, b)) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique_eq(list) {
  var ptr = 1
    , len = list.length
    , a=list[0], b = list[0]
  for(var i=1; i<len; ++i, b=a) {
    b = a
    a = list[i]
    if(a !== b) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique(list, compare, sorted) {
  if(list.length === 0) {
    return []
  }
  if(compare) {
    if(!sorted) {
      list.sort(compare)
    }
    return unique_pred(list, compare)
  }
  if(!sorted) {
    list.sort()
  }
  return unique_eq(list)
}

module.exports = unique
},{}],232:[function(require,module,exports){
arguments[4][81][0].apply(exports,arguments)
},{"dup":81,"typedarray-pool":245}],233:[function(require,module,exports){
arguments[4][83][0].apply(exports,arguments)
},{"dup":83}],234:[function(require,module,exports){
arguments[4][85][0].apply(exports,arguments)
},{"dup":85,"typedarray-pool":245}],235:[function(require,module,exports){
arguments[4][86][0].apply(exports,arguments)
},{"dup":86,"invert-permutation":236,"typedarray-pool":245}],236:[function(require,module,exports){
arguments[4][87][0].apply(exports,arguments)
},{"dup":87}],237:[function(require,module,exports){
arguments[4][89][0].apply(exports,arguments)
},{"dup":89,"gamma":233,"permutation-parity":234,"permutation-rank":235}],238:[function(require,module,exports){
arguments[4][90][0].apply(exports,arguments)
},{"cwise-compiler":239,"dup":90}],239:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./lib/thunk.js":241,"dup":4}],240:[function(require,module,exports){
arguments[4][5][0].apply(exports,arguments)
},{"dup":5,"uniq":242}],241:[function(require,module,exports){
arguments[4][6][0].apply(exports,arguments)
},{"./compile.js":240,"dup":6}],242:[function(require,module,exports){
arguments[4][7][0].apply(exports,arguments)
},{"dup":7}],243:[function(require,module,exports){
arguments[4][95][0].apply(exports,arguments)
},{"./lib/zc-core":238,"dup":95}],244:[function(require,module,exports){
arguments[4][96][0].apply(exports,arguments)
},{"dup":96,"ndarray-extract-contour":232,"triangulate-hypercube":237,"zero-crossings":243}],245:[function(require,module,exports){
arguments[4][10][0].apply(exports,arguments)
},{"bit-twiddle":186,"buffer":250,"dup":10}],246:[function(require,module,exports){
'use strict'

module.exports = createSurfacePlot

var bits          = require('bit-twiddle')
var createBuffer  = require('gl-buffer')
var createVAO     = require('gl-vao')
var createTexture = require('gl-texture2d')
var pool          = require('typedarray-pool')
var colormap      = require('colormap')
var ops           = require('ndarray-ops')
var pack          = require('ndarray-pack')
var ndarray       = require('ndarray')
var surfaceNets   = require('surface-nets')
var multiply      = require('gl-mat4/multiply')
var invert        = require('gl-mat4/invert')
var bsearch       = require('binary-search-bounds')
var gradient      = require('ndarray-gradient')
var shaders       = require('./lib/shaders')

var createShader            = shaders.createShader
var createContourShader     = shaders.createContourShader
var createPickShader        = shaders.createPickShader
var createPickContourShader = shaders.createPickContourShader

var SURFACE_VERTEX_SIZE = 4 * (4 + 2 + 3)

var IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1 ]

var QUAD = [
  [0, 0],
  [0, 1],
  [1, 0],
  [1, 1],
  [1, 0],
  [0, 1]
]

var PERMUTATIONS = [
  [0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0]
]

;(function() {
  for(var i=0; i<3; ++i) {
    var p = PERMUTATIONS[i]
    var u = (i+1) % 3
    var v = (i+2) % 3
    p[u + 0] = 1
    p[v + 3] = 1
    p[i + 6] = 1
  }
})()

function SurfacePickResult(position, index, uv, level) {
  this.position     = position
  this.index        = index
  this.uv           = uv
  this.level        = level
}

function genColormap(name) {
  var x = pack([colormap({
    colormap: name,
    nshades: 256,
    format: 'rgba'
  }).map(function(c) {
    return [c[0], c[1], c[2], 255*c[3]]
  })])
  ops.divseq(x, 255.0)
  return x
}

function clampVec(v) {
  var result = new Array(3)
  for(var i=0; i<3; ++i) {
    result[i] = Math.min(Math.max(v[i], -1e8), 1e8)
  }
  return result
}

function SurfacePlot(
  gl, 
  shape, 
  bounds, 
  shader, 
  pickShader, 
  coordinates, 
  vao, 
  colorMap,
  contourShader,
  contourPickShader,
  contourBuffer,
  contourVAO,
  dynamicBuffer,
  dynamicVAO) {

  this.gl                 = gl
  this.shape              = shape
  this.bounds             = bounds

  this._shader            = shader
  this._pickShader        = pickShader
  this._coordinateBuffer  = coordinates
  this._vao               = vao
  this._colorMap          = colorMap

  this._contourShader     = contourShader
  this._contourPickShader = contourPickShader
  this._contourBuffer     = contourBuffer
  this._contourVAO        = contourVAO
  this._contourOffsets    = [[], [], []]
  this._contourCounts     = [[], [], []]
  this._vertexCount       = 0
  
  this._pickResult        = new SurfacePickResult([0,0,0], [0,0], [0,0], [0,0,0])

  this._dynamicBuffer     = dynamicBuffer
  this._dynamicVAO        = dynamicVAO
  this._dynamicOffsets    = [0,0,0]
  this._dynamicCounts     = [0,0,0]

  this.contourWidth       = [ 1, 1, 1 ]
  this.contourLevels      = [[1], [1], [1]]
  this.contourTint        = [0, 0, 0]
  this.contourColor       = [[0.5,0.5,0.5,1], [0.5,0.5,0.5,1], [0.5,0.5,0.5,1]]

  this.showContour        = true
  this.showSurface        = true

  this.enableHighlight    = [true, true, true]
  this.highlightColor     = [[0,0,0,1], [0,0,0,1], [0,0,0,1]]
  this.highlightTint      = [ 1, 1, 1 ]
  this.highlightLevel     = [-1, -1, -1]

  //Dynamic contour options
  this.enableDynamic      = [ true, true, true ]
  this.dynamicLevel       = [ NaN, NaN, NaN ]
  this.dynamicColor       = [ [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1] ]
  this.dynamicTint        = [ 1, 1, 1 ]
  this.dynamicWidth       = [ 1, 1, 1 ]

  this.axesBounds         = [[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]
  this.surfaceProject     = [ false, false, false ]
  this.contourProject     = [[ false, false, false ],
                             [ false, false, false ],
                             [ false, false, false ]]

  //Store xyz fields, need this for picking
  this._field             = [ 
      ndarray(pool.mallocFloat(1024), [0,0]), 
      ndarray(pool.mallocFloat(1024), [0,0]), 
      ndarray(pool.mallocFloat(1024), [0,0]) ]

  this.pickId             = 1
  this.clipBounds         = [[-Infinity,-Infinity,-Infinity],[Infinity,Infinity,Infinity]]
  
  this.snapToData         = false

  this.opacity            = 1.0

  this.lightPosition      = [10, 10000, 0]
  this.ambientLight       = 0.8
  this.diffuseLight       = 0.8
  this.specularLight      = 2.0
  this.roughness          = 0.5
  this.fresnel            = 1.5

  this.dirty              = true
}

var proto = SurfacePlot.prototype

proto.isTransparent = function() {
  return this.opacity < 1
}

proto.isOpaque = function() {
  if(this.opacity >= 1) {
    return true
  }
  for(var i=0; i<3; ++i) {
    if(this._contourCounts[i].length > 0 || this._dynamicCounts[i] > 0) {
      return true
    }
  }
  return false
}

proto.pickSlots = 1

proto.setPickBase = function(id) {
  this.pickId = id
}

var ZERO_VEC = [0,0,0]

var PROJECT_DATA = {
  showSurface: false,
  showContour: false,
  projections: [IDENTITY.slice(), IDENTITY.slice(), IDENTITY.slice()],
  clipBounds:   [
    [[0,0,0], [0,0,0]], 
    [[0,0,0], [0,0,0]],
    [[0,0,0], [0,0,0]]]
}

function computeProjectionData(camera, obj) {
  //Compute cube properties
  var cubeAxis  = (obj.axes && obj.axes.lastCubeProps.axis) || ZERO_VEC

  var showSurface = obj.showSurface
  var showContour = obj.showContour
  
  for(var i=0; i<3; ++i) {
    showSurface = showSurface || obj.surfaceProject[i]
    for(var j=0; j<3; ++j) {
      showContour = showContour || obj.contourProject[i][j]
    }
  }

  for(var i=0; i<3; ++i) {
    //Construct projection onto axis
    var axisSquish = PROJECT_DATA.projections[i]
    for(var j=0; j<16; ++j) {
      axisSquish[j] = 0
    }
    for(var j=0; j<4; ++j) {
      axisSquish[5*j] = 1
    }
    axisSquish[5*i] = 0
    axisSquish[12+i] = obj.axesBounds[+(cubeAxis[i]>0)][i]
    multiply(axisSquish, camera.model, axisSquish)
    
    var nclipBounds = PROJECT_DATA.clipBounds[i]
    for(var k=0; k<2; ++k) {
      for(var j=0; j<3; ++j) {
        nclipBounds[k][j] = camera.clipBounds[k][j]
      }
    }
    nclipBounds[0][i] = -1e8
    nclipBounds[1][i] = 1e8
  }

  PROJECT_DATA.showSurface = showSurface
  PROJECT_DATA.showContour = showContour

  return PROJECT_DATA
}

var UNIFORMS = {
  model:      IDENTITY,
  view:       IDENTITY,
  projection: IDENTITY,
  lowerBound: [0,0,0],
  upperBound: [0,0,0],
  colorMap:   0,
  clipBounds: [[0,0,0], [0,0,0]],
  height:     0.0,
  contourTint: 0,
  contourColor: [0,0,0,1],
  permutation: [1,0,0,0,1,0,0,0,1],
  zOffset: -1e-4,
  kambient: 1,
  kdiffuse: 1,
  kspecular: 1,
  lightPosition: [1000,1000,1000],
  eyePosition: [0,0,0],
  roughness: 1,
  fresnel: 1,
  opacity: 1
}

var MATRIX_INVERSE = IDENTITY.slice()
var DEFAULT_PERM = [1,0,0,0,1,0,0,0,1]

function drawCore(params, transparent) {
  params = params || {}
  var gl = this.gl

  gl.disable(gl.CULL_FACE)

  this._colorMap.bind(0)

  var uniforms = UNIFORMS
  uniforms.model        = params.model || IDENTITY
  uniforms.view         = params.view || IDENTITY
  uniforms.projection   = params.projection || IDENTITY
  uniforms.lowerBound   = this.bounds[0]
  uniforms.upperBound   = this.bounds[1]
  uniforms.contourColor = this.contourColor[0]

  for(var i=0; i<2; ++i) {
    var clipClamped = uniforms.clipBounds[i]
    for(var j=0; j<3; ++j) {
      clipClamped[j] = Math.min(Math.max(this.clipBounds[i][j], -1e8), 1e8)
    }
  }

  uniforms.kambient   = this.ambientLight
  uniforms.kdiffuse   = this.diffuseLight
  uniforms.kspecular  = this.specularLight

  uniforms.shape = 

  uniforms.roughness  = this.roughness
  uniforms.fresnel    = this.fresnel
  uniforms.opacity    = this.opacity

  uniforms.height = 0.0
  uniforms.permutation = DEFAULT_PERM

  //Compute camera matrix inverse
  var invCameraMatrix = MATRIX_INVERSE
  multiply(invCameraMatrix, uniforms.view, uniforms.model)
  multiply(invCameraMatrix, uniforms.projection, invCameraMatrix)
  invert(invCameraMatrix, invCameraMatrix)

  for(var i=0; i<3; ++i) {
    uniforms.eyePosition[i] = invCameraMatrix[12+i] / invCameraMatrix[15]
  }

  var w = invCameraMatrix[15]
  for(var i=0; i<3; ++i) {
    w += this.lightPosition[i] * invCameraMatrix[4*i+3]
  }
  for(var i=0; i<3; ++i) {
    var s = invCameraMatrix[12+i]
    for(var j=0; j<3; ++j) {
      s += invCameraMatrix[4*j+i] * this.lightPosition[j]
    }
    uniforms.lightPosition[i] = s / w
  }

  var projectData = computeProjectionData(uniforms, this)

  if(projectData.showSurface && (transparent === (this.opacity < 1))) {
    //Set up uniforms
    this._shader.bind()
    this._shader.uniforms = uniforms

    //Draw it
    this._vao.bind()

    if(this.showSurface) {
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.surfaceProject[i]) {
        continue
      }
      this._shader.uniforms.model = projectData.projections[i]
      this._shader.uniforms.clipBounds = projectData.clipBounds[i]
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    this._vao.unbind()
  }

  if(projectData.showContour && !transparent) {
    var shader = this._contourShader

    //Don't apply lighting to contours
    uniforms.kambient = 1.0
    uniforms.kdiffuse = 0.0
    uniforms.kspecular = 0.0
    uniforms.opacity = 1.0

    shader.bind()
    shader.uniforms = uniforms

    //Draw contour lines
    var vao = this._contourVAO
    vao.bind()

    //Draw contour levels
    for(var i=0; i<3; ++i) {
      shader.uniforms.permutation = PERMUTATIONS[i]
      gl.lineWidth(this.contourWidth[i])

      for(var j=0; j<this.contourLevels[i].length; ++j) {
        if(j === this.highlightLevel[i]) {
          shader.uniforms.contourColor = this.highlightColor[i]
          shader.uniforms.contourTint  = this.highlightTint[i]

        } else if(j === 0 || (j-1) === this.highlightLevel[i]) {
          shader.uniforms.contourColor = this.contourColor[i]
          shader.uniforms.contourTint  = this.contourTint[i]
        }
        shader.uniforms.height = this.contourLevels[i][j]
        vao.draw(gl.LINES, this._contourCounts[i][j], this._contourOffsets[i][j])
      }
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      shader.uniforms.model      = projectData.projections[i]
      shader.uniforms.clipBounds = projectData.clipBounds[i]
      for(var j=0; j<3; ++j) {
        if(!this.contourProject[i][j]) {
          continue
        }
        shader.uniforms.permutation = PERMUTATIONS[j]
        gl.lineWidth(this.contourWidth[j])
        for(var k=0; k<this.contourLevels[j].length; ++k) {
          if(k === this.highlightLevel[j]) {
            shader.uniforms.contourColor  = this.highlightColor[j]
            shader.uniforms.contourTint   = this.highlightTint[j]
          } else if(k === 0 || (k-1) === this.highlightLevel[j]) {
            shader.uniforms.contourColor  = this.contourColor[j]
            shader.uniforms.contourTint   = this.contourTint[j]
          }
          shader.uniforms.height = this.contourLevels[j][k]
          vao.draw(gl.LINES, this._contourCounts[j][k], this._contourOffsets[j][k])
        }
      }
    }
    
    //Draw dynamic contours
    vao = this._dynamicVAO
    vao.bind()

    //Draw contour levels
    for(var i=0; i<3; ++i) {
      if(this._dynamicCounts[i] === 0) {
        continue
      }

      shader.uniforms.model       = uniforms.model
      shader.uniforms.clipBounds  = uniforms.clipBounds
      shader.uniforms.permutation = PERMUTATIONS[i]
      gl.lineWidth(this.dynamicWidth[i])

      shader.uniforms.contourColor = this.dynamicColor[i]
      shader.uniforms.contourTint  = this.dynamicTint[i]
      shader.uniforms.height       = this.dynamicLevel[i]
      vao.draw(gl.LINES, this._dynamicCounts[i], this._dynamicOffsets[i])

      for(var j=0; j<3; ++j) {
        if(!this.contourProject[j][i]) {
          continue
        }

        shader.uniforms.model      = projectData.projections[j]
        shader.uniforms.clipBounds = projectData.clipBounds[j]
        vao.draw(gl.LINES, this._dynamicCounts[i], this._dynamicOffsets[i])
      }
    }

    vao.unbind()
  }
}

proto.draw = function(params) {
  return drawCore.call(this, params, false)
}

proto.drawTransparent = function(params) {
  return drawCore.call(this, params, true)
}

var PICK_UNIFORMS = {
  model:          IDENTITY,
  view:           IDENTITY,
  projection:     IDENTITY,
  clipBounds:     [[0,0,0],[0,0,0]],
  height:         0.0,
  shape:          [0,0],
  pickId:         0,
  lowerBound:     [0,0,0],
  upperBound:     [0,0,0],
  zOffset:        0.0,
  permutation:    [1,0,0,0,1,0,0,0,1],
  lightPosition:  [0,0,0],
  eyePosition:    [0,0,0]
}

proto.drawPick = function(params) {
  params = params || {}
  var gl = this.gl
  gl.disable(gl.CULL_FACE)
  
  var uniforms = PICK_UNIFORMS
  uniforms.model = params.model || IDENTITY
  uniforms.view = params.view || IDENTITY
  uniforms.projection = params.projection || IDENTITY
  uniforms.shape = this._field[2].shape
  uniforms.pickId = this.pickId / 255.0
  uniforms.lowerBound = this.bounds[0]
  uniforms.upperBound = this.bounds[1]
  uniforms.permutation = DEFAULT_PERM

  for(var i=0; i<2; ++i) {
    var clipClamped = uniforms.clipBounds[i]
    for(var j=0; j<3; ++j) {
      clipClamped[j] = Math.min(Math.max(this.clipBounds[i][j], -1e8), 1e8)
    }
  }

  var projectData = computeProjectionData(uniforms, this)

  if(projectData.showSurface) {
    //Set up uniforms
    this._pickShader.bind()
    this._pickShader.uniforms = uniforms

    //Draw it
    this._vao.bind()
    this._vao.draw(gl.TRIANGLES, this._vertexCount)

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      if(!this.surfaceProject[i]) {
        continue
      }
      this._pickShader.uniforms.model = projectData.projections[i]
      this._pickShader.uniforms.clipBounds = projectData.clipBounds[i]
      this._vao.draw(gl.TRIANGLES, this._vertexCount)
    }

    this._vao.unbind()
  }

  if(projectData.showContour) {
    var shader = this._contourPickShader

    shader.bind()
    shader.uniforms = uniforms

    var vao = this._contourVAO
    vao.bind()

    for(var j=0; j<3; ++j) {
      gl.lineWidth(this.contourWidth[j])
      shader.uniforms.permutation = PERMUTATIONS[j]
      for(var i=0; i<this.contourLevels[j].length; ++i) {
        shader.uniforms.height = this.contourLevels[j][i]
        vao.draw(gl.LINES, this._contourCounts[j][i], this._contourOffsets[j][i])
      }
    }

    //Draw projections of surface
    for(var i=0; i<3; ++i) {
      shader.uniforms.model      = projectData.projections[i]
      shader.uniforms.clipBounds = projectData.clipBounds[i]
      
      for(var j=0; j<3; ++j) {
        if(!this.contourProject[i][j]) {
          continue
        }
        
        shader.uniforms.permutation = PERMUTATIONS[j]
        gl.lineWidth(this.contourWidth[j])
        for(var k=0; k<this.contourLevels[j].length; ++k) {
          shader.uniforms.height = this.contourLevels[j][k]
          vao.draw(gl.LINES, this._contourCounts[j][k], this._contourOffsets[j][k])
        }
      }
    }

    vao.unbind()
  }
}


proto.pick = function(selection) {
  if(!selection) {
    return null
  }

  if(selection.id !== this.pickId) {
    return null
  }

  var shape = this._field[2].shape

  var result = this._pickResult

  //Compute uv coordinate
  var x = shape[0] * (selection.value[0] + (selection.value[2]>>4)/16.0)/255.0
  var ix = Math.floor(x)
  var fx = x - ix

  var y = shape[1] * (selection.value[1] + (selection.value[2]&15)/16.0)/255.0
  var iy = Math.floor(y)
  var fy = y - iy

  ix += 1
  iy += 1

  //Compute xyz coordinate
  var pos = result.position
  pos[0] = pos[1] = pos[2] = 0
  for(var dx=0; dx<2; ++dx) {
    var s = dx ? fx : 1.0 - fx
    for(var dy=0; dy<2; ++dy) {
      var t = dy ? fy : 1.0 - fy

      var r = ix + dx
      var c = iy + dy
      var w = s * t

      for(var i=0; i<3; ++i) {
        pos[i] += this._field[i].get(r,c) * w
      }
    }
  }

  //Find closest level
  var levelIndex = this._pickResult.level
  for(var j=0; j<3; ++j) {
    levelIndex[j] = bsearch.le(this.contourLevels[j], pos[j])
    if(levelIndex[j] < 0) {
      if(this.contourLevels[j].length > 0) {
        levelIndex[j] = 0
      }
    } else if(levelIndex[j] < this.contourLevels[j].length-1) {
      var a = this.contourLevels[j][levelIndex[j]]
      var b = this.contourLevels[j][levelIndex[j]+1]
      if(Math.abs(a-pos[j]) > Math.abs(b-pos[j])) {
        levelIndex[j] += 1
      }
    }
  }

  result.index[0] = fx<0.5 ? ix : (ix+1)
  result.index[1] = fy<0.5 ? iy : (iy+1)

  result.uv[0] = x/shape[0]
  result.uv[1] = y/shape[1]

  return result
}

function padField(nfield, field) {

  var shape = field.shape.slice()
  var nshape = nfield.shape.slice()

  //Center
  ops.assign(nfield.lo(1,1).hi(shape[0], shape[1]), field)

  //Edges
  ops.assign(nfield.lo(1).hi(shape[0], 1), 
              field.hi(shape[0], 1))
  ops.assign(nfield.lo(1,nshape[1]-1).hi(shape[0],1),
              field.lo(0,shape[1]-1).hi(shape[0],1))
  ops.assign(nfield.lo(0,1).hi(1,shape[1]),
              field.hi(1))
  ops.assign(nfield.lo(nshape[0]-1,1).hi(1,shape[1]),
              field.lo(shape[0]-1))
  //Corners
  nfield.set(0,0, field.get(0,0))
  nfield.set(0,nshape[1]-1, field.get(0,shape[1]-1))
  nfield.set(nshape[0]-1,0, field.get(shape[0]-1,0))
  nfield.set(nshape[0]-1,nshape[1]-1, field.get(shape[0]-1,shape[1]-1))
}

function handleArray(param, ctor) {
  if(Array.isArray(param)) {
    return [ ctor(param[0]), ctor(param[1]), ctor(param[2]) ]
  }
  return [ ctor(param), ctor(param), ctor(param) ]
}

function toColor(x) {
  if(Array.isArray(x)) {
    if(x.length === 3) {
      return [x[0], x[1], x[2], 1]
    }
    return [x[0], x[1], x[2], x[3]]
  }
  return [0,0,0,1]
}

function handleColor(param) {
  if(Array.isArray(param)) {
    if(Array.isArray(param)) {
      return [  toColor(param[0]), 
                toColor(param[1]),
                toColor(param[2]) ]
    } else {
      var c = toColor(param)
      return [ 
        c.slice(), 
        c.slice(), 
        c.slice() ]
    }
  }
}

proto.update = function(params) {
  params = params || {}

  this.dirty = true

  if('contourWidth' in params) {
    this.contourWidth = handleArray(params.contourWidth, Number)
  }
  if('showContour' in params) {
    this.showContour = handleArray(params.showContour, Boolean)
  }
  if('showSurface' in params) {
    this.showSurface = !!params.showSurface
  }
  if('contourTint' in params) {
    this.contourTint = handleArray(params.contourTint, Boolean)
  }
  if('contourColor' in params) {
    this.contourColor = handleColor(params.contourColor)
  }
  if('contourProject' in params) {
    this.contourProject = handleArray(params.contourProject, function(x) {
      return handleArray(x, Boolean)
    })
  }
  if('surfaceProject' in params) {
    this.surfaceProject = params.surfaceProject
  }
  if('dynamicColor' in params) {
    this.dynamicColor = handleColor(params.dynamicColor)
  }
  if('dynamicTint' in params) {
    this.dynamicTint = handleArray(params.dynamicTint, Number)
  }
  if('dynamicWidth' in params) {
    this.dynamicWidth = handleArray(params.dynamicWidth, Number)
  }
  if('opacity' in params) {
    this.opacity = params.opacity
  }

  var field = params.field || (params.coords && params.coords[2])

  //Update field
  if('field' in params) {
    var field = params.field
    var fsize = (field.shape[0]+2)*(field.shape[1]+2)

    //Resize if necessary
    if(fsize > this._field[2].data.length) {
      pool.freeFloat(this._field[2].data)
      this._field[2].data = pool.mallocFloat(bits.nextPow2(fsize))
    }

    //Pad field
    this._field[2] = ndarray(this._field[2].data, [field.shape[0]+2, field.shape[1]+2])
    padField(this._field[2], field)

    //Save shape of field
    this.shape = field.shape.slice()
    var shape = this.shape

    //Resize coordinate fields if necessary
    for(var i=0; i<2; ++i) {
      if(this._field[2].size > this._field[i].data.length) {
        pool.freeFloat(this._field[i].data)
        this._field[i].data = pool.mallocFloat(this._field[2].size)
      }
      this._field[i] = ndarray(this._field[i].data, [shape[0]+2, shape[1]+2])
    }

    //Generate x/y coordinates
    if(params.coords) {
      var coords = params.coords
      if(!Array.isArray(coords) || coords.length !== 3) {
        throw new Error('gl-surface: invalid coordinates for x/y')
      }
      for(var i=0; i<2; ++i) {
        var coord = coords[i]
        for(var j=0; j<2; ++j) {
          if(coord.shape[j] !== shape[j]) {
            throw new Error('gl-surface: coords have incorrect shape')
          }
        }
        padField(this._field[i], coord)
      }
    } else if(params.ticks) {
      var ticks = params.ticks
      if(!Array.isArray(ticks) || ticks.length !== 2) {
        throw new Error('gl-surface: invalid ticks')
      }
      for(var i=0; i<2; ++i) {
        var tick = ticks[i]
        if(Array.isArray(tick) || tick.length) {
          tick = ndarray(tick)
        }
        if(tick.shape[0] !== shape[i]) {
          throw new Error('gl-surface: invalid tick length')
        }
        //Make a copy view of the tick array
        var tick2 = ndarray(tick.data, shape)
        tick2.stride[i] = tick.stride[0]
        tick2.stride[i^1] = 0

        //Fill in field array
        padField(this._field[i], tick2)
      }    
    } else {
      for(var i=0; i<2; ++i) {
        var offset = [0,0]
        offset[i] = 1
        this._field[i] = ndarray(this._field[i].data, [shape[0]+2, shape[1]+2], offset, 0)
      }
      this._field[0].set(0,0,0)
      for(var j=0; j<shape[0]; ++j) {
        this._field[0].set(j+1,0,j)
      }
      this._field[0].set(shape[0]+1,0,shape[0]-1)
      this._field[1].set(0,0,0)
      for(var j=0; j<shape[1]; ++j) {
        this._field[1].set(0,j+1,j)
      }
      this._field[1].set(0,shape[1]+1, shape[1]-1)
    }

    //Save shape
    var fields = this._field

    //Compute surface normals
    var fieldSize = fields[2].size
    var dfields = ndarray(pool.mallocFloat(fields[2].size*3*2), [3, shape[0]+2, shape[1]+2, 2])
    for(var i=0; i<3; ++i) {
      gradient(dfields.pick(i), fields[i], 'mirror')
    }
    var normals = ndarray(pool.mallocFloat(fields[2].size*3), [shape[0]+2, shape[1]+2, 3])
    for(var i=0; i<shape[0]+2; ++i) {
      for(var j=0; j<shape[1]+2; ++j) {
        var dxdu = dfields.get(0, i, j, 0)
        var dxdv = dfields.get(0, i, j, 1)
        var dydu = dfields.get(1, i, j, 0)
        var dydv = dfields.get(1, i, j, 1)
        var dzdu = dfields.get(2, i, j, 0)
        var dzdv = dfields.get(2, i, j, 1)

        var nx = dydu * dzdv - dydv * dzdu
        var ny = dzdu * dxdv - dzdv * dxdu
        var nz = dxdu * dydv - dxdv * dydu

        var nl = nx*nx + ny * ny + nz * nz
        if(nl < 1e-6) {
          nl = 0.0
        } else {
          nl = 1.0 / Math.sqrt(nl)
        }

        normals.set(i,j,0, nx*nl)
        normals.set(i,j,1, ny*nl)
        normals.set(i,j,2, nz*nl)
      }
    }
    pool.free(dfields.data)

    //Initialize surface
    var lo = [ Infinity, Infinity, Infinity]
    var hi = [-Infinity,-Infinity,-Infinity]
    var count   = (shape[0]-1) * (shape[1]-1) * 6
    var tverts  = pool.mallocFloat(bits.nextPow2(9*count))
    var tptr    = 0
    var fptr    = 0
    var vertexCount = 0
    for(var i=0; i<shape[0]-1; ++i) {
  j_loop:
      for(var j=0; j<shape[1]-1; ++j) {

        //Test for NaNs
        for(var dx=0; dx<2; ++dx) {
          for(var dy=0; dy<2; ++dy) {
            for(var k=0; k<3; ++k) {
              var f = this._field[k].get(1+i+dx, 1+j+dy)
              if(isNaN(f) || !isFinite(f)) {
                continue j_loop
              }
            }
          }
        }
        for(var k=0; k<6; ++k) {
          var r = i + QUAD[k][0]
          var c = j + QUAD[k][1]

          var tx = this._field[0].get(r+1, c+1)
          var ty = this._field[1].get(r+1, c+1)
          var f  = this._field[2].get(r+1, c+1)
          var nx = normals.get(r+1, c+1, 0)
          var ny = normals.get(r+1, c+1, 1)
          var nz = normals.get(r+1, c+1, 2)

          tverts[tptr++] = r
          tverts[tptr++] = c
          tverts[tptr++] = tx
          tverts[tptr++] = ty
          tverts[tptr++] = f
          tverts[tptr++] = 0
          tverts[tptr++] = nx
          tverts[tptr++] = ny
          tverts[tptr++] = nz

          lo[0] = Math.min(lo[0], tx)
          lo[1] = Math.min(lo[1], ty)
          lo[2] = Math.min(lo[2], f)

          hi[0] = Math.max(hi[0], tx)
          hi[1] = Math.max(hi[1], ty)
          hi[2] = Math.max(hi[2], f)

          vertexCount += 1
        }
      }
    }
    this._vertexCount = vertexCount
    this._coordinateBuffer.update(tverts.subarray(0,tptr))
    pool.freeFloat(tverts)
    pool.free(normals.data)
    
    //Update bounds
    this.bounds = [lo, hi]
  }

  //Update level crossings
  var levelsChanged = false
  if('levels' in params) {
    var levels = params.levels
    if(!Array.isArray(levels[0])) {

      levels = [ [], [], levels ]
    } else {
      levels = levels.slice()
    }
    for(var i=0; i<3; ++i) {
      levels[i] = levels[i].slice()
      levels.sort(function(a,b) {
        return a-b
      })
    }
change_test:
    for(var i=0; i<3; ++i) {
      if(levels[i].length !== this.contourLevels[i].length) {
        levelsChanged = true
        break
      }
      for(var j=0; j<levels[i].length; ++j) {
        if(levels[i][j] !== this.contourLevels[i][j]) {
          levelsChanged = true
          break change_test
        }
      }
    }
    this.contourLevels = levels
  }

  if(levelsChanged) {
    var fields = this._field
    var shape  = this.shape

    //Update contour lines
    var contourVerts = []

    for(var dim=0; dim<3; ++dim) {
      var levels = this.contourLevels[dim]
      var levelOffsets = []
      var levelCounts  = []

      var parts = [0,0]
      var graphParts = [0,0]

      for(var i=0; i<levels.length; ++i) {
        var graph = surfaceNets(this._field[dim], levels[i])
        levelOffsets.push((contourVerts.length/4)|0)
        var vertexCount = 0

  edge_loop:
        for(var j=0; j<graph.cells.length; ++j) {
          var e = graph.cells[j]
          for(var k=0; k<2; ++k) {
            var p = graph.positions[e[k]]

            var x = p[0]
            var ix = Math.floor(x)|0
            var fx = x - ix

            var y = p[1]
            var iy = Math.floor(y)|0
            var fy = y - iy

            var hole = false
  dd_loop:
            for(var dd=0; dd<2; ++dd) {
              parts[dd] = 0.0
              var iu = (dim + dd + 1) % 3            
              for(var dx=0; dx<2; ++dx) {
                var s = dx ? fx : 1.0 - fx
                var r = Math.min(Math.max(ix+dx, 0), shape[0])|0
                for(var dy=0; dy<2; ++dy) {
                  var t = dy ? fy : 1.0 - fy
                  var c = Math.min(Math.max(iy+dy, 0), shape[1])|0

                  var f = this._field[iu].get(r,c)
                  if(!isFinite(f) || isNaN(f)) {
                    hole = true
                    break dd_loop
                  }

                  var w = s * t
                  parts[dd] += w * f
                }
              }
            }

            if(!hole) {
              contourVerts.push(parts[0], parts[1], p[0], p[1])
              vertexCount += 1
            } else {
              if(k > 0) {
                //If we already added first edge, pop off verts
                for(var l=0; l<4; ++l) {
                  contourVerts.pop()
                }
                vertexCount -= 1
              }
              continue edge_loop
            }
          }
        }
        levelCounts.push(vertexCount)
      }

      //Store results
      this._contourOffsets[dim]  = levelOffsets
      this._contourCounts[dim]   = levelCounts
    }

    var floatBuffer = pool.mallocFloat(contourVerts.length)
    for(var i=0; i<contourVerts.length; ++i) {
      floatBuffer[i] = contourVerts[i]
    }
    this._contourBuffer.update(floatBuffer)
    pool.freeFloat(floatBuffer)
  }

  if(params.colormap) {
    this._colorMap.setPixels(genColormap(params.colormap))
  }
}

proto.dispose = function() {
  this._shader.dispose()
  this._vao.dispose()
  this._coordinateBuffer.dispose()
  this._colorMap.dispose()
  this._contourBuffer.dispose()
  this._contourVAO.dispose()
  this._contourShader.dispose()
  this._contourPickShader.dispose()
  this._dynamicBuffer.dispose()
  this._dynamicVAO.dispose()
  for(var i=0; i<3; ++i) {
    pool.freeFloat(this._field[i].data)
  }
}

proto.highlight = function(selection) {
  if(!selection) {
    this._dynamicCounts = [0,0,0]
    this.dyanamicLevel = [NaN, NaN, NaN]
    this.highlightLevel = [-1,-1,-1]
    return
  }

  for(var i=0; i<3; ++i) {
    if(this.enableHighlight[i]) {
      this.highlightLevel[i] = selection.level[i]
    } else {
      this.highlightLevel[i] = -1
    }
  }

  var levels
  if(this.snapToData) {
    levels = selection.dataCoordinate
  } else {
    levels = selection.position
  }
  if( (!this.enableDynamic[0] || levels[0] === this.dynamicLevel[0]) &&
      (!this.enableDynamic[1] || levels[1] === this.dynamicLevel[1]) &&
      (!this.enableDynamic[2] || levels[2] === this.dynamicLevel[2]) ) {
    return
  }

  var vertexCount = 0
  var shape = this.shape
  var scratchBuffer = pool.mallocFloat(12 * shape[0] * shape[1]) 
  
  for(var d=0; d<3; ++d) {
    if(!this.enableDynamic[d]) {
      this.dynamicLevel[d] = NaN
      this._dynamicCounts[d] = 0
      continue
    }

    this.dynamicLevel[d] = levels[d]

    var u = (d+1) % 3
    var v = (d+2) % 3

    var f = this._field[d]
    var g = this._field[u]
    var h = this._field[v]

    var graph     = surfaceNets(f, levels[d])
    var edges     = graph.cells
    var positions = graph.positions

    this._dynamicOffsets[d] = vertexCount

    for(var i=0; i<edges.length; ++i) {
      var e = edges[i]
      for(var j=0; j<2; ++j) {
        var p  = positions[e[j]]

        var x  = +p[0]
        var ix = x|0
        var jx = Math.min(ix+1, shape[0])|0
        var fx = x - ix
        var hx = 1.0 - fx
        
        var y  = +p[1]
        var iy = y|0
        var jy = Math.min(iy+1, shape[1])|0
        var fy = y - iy
        var hy = 1.0 - fy
        
        var w00 = hx * hy
        var w01 = hx * fy
        var w10 = fx * hy
        var w11 = fx * fy

        var cu =  w00 * g.get(ix,iy) +
                  w01 * g.get(ix,jy) +
                  w10 * g.get(jx,iy) +
                  w11 * g.get(jx,jy)

        var cv =  w00 * h.get(ix,iy) +
                  w01 * h.get(ix,jy) +
                  w10 * h.get(jx,iy) +
                  w11 * h.get(jx,jy)

        if(isNaN(cu) || isNaN(cv)) {
          if(j) {
            vertexCount -= 1
          }
          break
        }

        scratchBuffer[2*vertexCount+0] = cu
        scratchBuffer[2*vertexCount+1] = cv

        vertexCount += 1
      }
    }

    this._dynamicCounts[d] = vertexCount - this._dynamicOffsets[d]
  }

  this._dynamicBuffer.update(scratchBuffer.subarray(0, 2*vertexCount))
  pool.freeFloat(scratchBuffer)
}

function createSurfacePlot(params) {

  var gl = params.gl
  var field = params.field || (params.coords && params.coords[2])

  var shader = createShader(gl)
  var pickShader = createPickShader(gl)
  var contourShader = createContourShader(gl)
  var contourPickShader = createPickContourShader(gl)
  
  var coordinateBuffer = createBuffer(gl)
  var vao = createVAO(gl, [
      { buffer: coordinateBuffer,
        size: 4,
        stride: SURFACE_VERTEX_SIZE,
        offset: 0
      },
      { buffer: coordinateBuffer,
        size: 2,
        stride: SURFACE_VERTEX_SIZE,
        offset: 16
      },
      {
        buffer: coordinateBuffer,
        size: 3,
        stride: SURFACE_VERTEX_SIZE,
        offset: 24
      }
    ])

  var contourBuffer = createBuffer(gl)
  var contourVAO = createVAO(gl, [
    { 
      buffer: contourBuffer,
      size: 4
    }])

  var dynamicBuffer = createBuffer(gl)
  var dynamicVAO = createVAO(gl, [
    {
      buffer: dynamicBuffer,
      size: 2,
      type: gl.FLOAT
    }])

  var cmap = createTexture(gl, 1, 256, gl.RGBA, gl.UNSIGNED_BYTE)
  cmap.minFilter = gl.LINEAR
  cmap.magFilter = gl.LINEAR

  var surface = new SurfacePlot(
    gl, 
    [0,0], 
    [[0,0,0], [0,0,0]], 
    shader,
    pickShader,
    coordinateBuffer, 
    vao,
    cmap,
    contourShader,
    contourPickShader,
    contourBuffer,
    contourVAO,
    dynamicBuffer,
    dynamicVAO)

  var nparams = {
    levels: [[], [], []]
  }
  for(var id in params) {
    nparams[id] = params[id]
  }
  nparams.field = field
  nparams.colormap = nparams.colormap || 'jet'

  surface.update(nparams)

  return surface
}
},{"./lib/shaders":184,"binary-search-bounds":185,"bit-twiddle":186,"colormap":188,"gl-buffer":191,"gl-mat4/invert":194,"gl-mat4/multiply":195,"gl-texture2d":207,"gl-vao":213,"ndarray":247,"ndarray-gradient":216,"ndarray-ops":221,"ndarray-pack":226,"surface-nets":244,"typedarray-pool":245}],247:[function(require,module,exports){
(function (Buffer){
var iota = require("iota-array")

var hasTypedArrays  = ((typeof Float64Array) !== "undefined")
var hasBuffer       = ((typeof Buffer) !== "undefined")

function compare1st(a, b) {
  return a[0] - b[0]
}

function order() {
  var stride = this.stride
  var terms = new Array(stride.length)
  var i
  for(i=0; i<terms.length; ++i) {
    terms[i] = [Math.abs(stride[i]), i]
  }
  terms.sort(compare1st)
  var result = new Array(terms.length)
  for(i=0; i<result.length; ++i) {
    result[i] = terms[i][1]
  }
  return result
}

function compileConstructor(dtype, dimension) {
  var className = ["View", dimension, "d", dtype].join("")
  if(dimension < 0) {
    className = "View_Nil" + dtype
  }
  var useGetters = (dtype === "generic")
  
  if(dimension === -1) {
    //Special case for trivial arrays
    var code = 
      "function "+className+"(a){this.data=a;};\
var proto="+className+".prototype;\
proto.dtype='"+dtype+"';\
proto.index=function(){return -1};\
proto.size=0;\
proto.dimension=-1;\
proto.shape=proto.stride=proto.order=[];\
proto.lo=proto.hi=proto.transpose=proto.step=\
function(){return new "+className+"(this.data);};\
proto.get=proto.set=function(){};\
proto.pick=function(){return null};\
return function construct_"+className+"(a){return new "+className+"(a);}"
    var procedure = new Function(code)
    return procedure()
  } else if(dimension === 0) {
    //Special case for 0d arrays
    var code =
      "function "+className+"(a,d) {\
this.data = a;\
this.offset = d\
};\
var proto="+className+".prototype;\
proto.dtype='"+dtype+"';\
proto.index=function(){return this.offset};\
proto.dimension=0;\
proto.size=1;\
proto.shape=\
proto.stride=\
proto.order=[];\
proto.lo=\
proto.hi=\
proto.transpose=\
proto.step=function "+className+"_copy() {\
return new "+className+"(this.data,this.offset)\
};\
proto.pick=function "+className+"_pick(){\
return TrivialArray(this.data);\
};\
proto.valueOf=proto.get=function "+className+"_get(){\
return "+(useGetters ? "this.data.get(this.offset)" : "this.data[this.offset]")+
"};\
proto.set=function "+className+"_set(v){\
return "+(useGetters ? "this.data.set(this.offset,v)" : "this.data[this.offset]=v")+"\
};\
return function construct_"+className+"(a,b,c,d){return new "+className+"(a,d)}"
    var procedure = new Function("TrivialArray", code)
    return procedure(CACHED_CONSTRUCTORS[dtype][0])
  }

  var code = ["'use strict'"]
    
  //Create constructor for view
  var indices = iota(dimension)
  var args = indices.map(function(i) { return "i"+i })
  var index_str = "this.offset+" + indices.map(function(i) {
        return "this.stride[" + i + "]*i" + i
      }).join("+")
  var shapeArg = indices.map(function(i) {
      return "b"+i
    }).join(",")
  var strideArg = indices.map(function(i) {
      return "c"+i
    }).join(",")
  code.push(
    "function "+className+"(a," + shapeArg + "," + strideArg + ",d){this.data=a",
      "this.shape=[" + shapeArg + "]",
      "this.stride=[" + strideArg + "]",
      "this.offset=d|0}",
    "var proto="+className+".prototype",
    "proto.dtype='"+dtype+"'",
    "proto.dimension="+dimension)
  
  //view.size:
  code.push("Object.defineProperty(proto,'size',{get:function "+className+"_size(){\
return "+indices.map(function(i) { return "this.shape["+i+"]" }).join("*"),
"}})")

  //view.order:
  if(dimension === 1) {
    code.push("proto.order=[0]")
  } else {
    code.push("Object.defineProperty(proto,'order',{get:")
    if(dimension < 4) {
      code.push("function "+className+"_order(){")
      if(dimension === 2) {
        code.push("return (Math.abs(this.stride[0])>Math.abs(this.stride[1]))?[1,0]:[0,1]}})")
      } else if(dimension === 3) {
        code.push(
"var s0=Math.abs(this.stride[0]),s1=Math.abs(this.stride[1]),s2=Math.abs(this.stride[2]);\
if(s0>s1){\
if(s1>s2){\
return [2,1,0];\
}else if(s0>s2){\
return [1,2,0];\
}else{\
return [1,0,2];\
}\
}else if(s0>s2){\
return [2,0,1];\
}else if(s2>s1){\
return [0,1,2];\
}else{\
return [0,2,1];\
}}})")
      }
    } else {
      code.push("ORDER})")
    }
  }
  
  //view.set(i0, ..., v):
  code.push(
"proto.set=function "+className+"_set("+args.join(",")+",v){")
  if(useGetters) {
    code.push("return this.data.set("+index_str+",v)}")
  } else {
    code.push("return this.data["+index_str+"]=v}")
  }
  
  //view.get(i0, ...):
  code.push("proto.get=function "+className+"_get("+args.join(",")+"){")
  if(useGetters) {
    code.push("return this.data.get("+index_str+")}")
  } else {
    code.push("return this.data["+index_str+"]}")
  }
  
  //view.index:
  code.push(
    "proto.index=function "+className+"_index(", args.join(), "){return "+index_str+"}")

  //view.hi():
  code.push("proto.hi=function "+className+"_hi("+args.join(",")+"){return new "+className+"(this.data,"+
    indices.map(function(i) {
      return ["(typeof i",i,"!=='number'||i",i,"<0)?this.shape[", i, "]:i", i,"|0"].join("")
    }).join(",")+","+
    indices.map(function(i) {
      return "this.stride["+i + "]"
    }).join(",")+",this.offset)}")
  
  //view.lo():
  var a_vars = indices.map(function(i) { return "a"+i+"=this.shape["+i+"]" })
  var c_vars = indices.map(function(i) { return "c"+i+"=this.stride["+i+"]" })
  code.push("proto.lo=function "+className+"_lo("+args.join(",")+"){var b=this.offset,d=0,"+a_vars.join(",")+","+c_vars.join(","))
  for(var i=0; i<dimension; ++i) {
    code.push(
"if(typeof i"+i+"==='number'&&i"+i+">=0){\
d=i"+i+"|0;\
b+=c"+i+"*d;\
a"+i+"-=d}")
  }
  code.push("return new "+className+"(this.data,"+
    indices.map(function(i) {
      return "a"+i
    }).join(",")+","+
    indices.map(function(i) {
      return "c"+i
    }).join(",")+",b)}")
  
  //view.step():
  code.push("proto.step=function "+className+"_step("+args.join(",")+"){var "+
    indices.map(function(i) {
      return "a"+i+"=this.shape["+i+"]"
    }).join(",")+","+
    indices.map(function(i) {
      return "b"+i+"=this.stride["+i+"]"
    }).join(",")+",c=this.offset,d=0,ceil=Math.ceil")
  for(var i=0; i<dimension; ++i) {
    code.push(
"if(typeof i"+i+"==='number'){\
d=i"+i+"|0;\
if(d<0){\
c+=b"+i+"*(a"+i+"-1);\
a"+i+"=ceil(-a"+i+"/d)\
}else{\
a"+i+"=ceil(a"+i+"/d)\
}\
b"+i+"*=d\
}")
  }
  code.push("return new "+className+"(this.data,"+
    indices.map(function(i) {
      return "a" + i
    }).join(",")+","+
    indices.map(function(i) {
      return "b" + i
    }).join(",")+",c)}")
  
  //view.transpose():
  var tShape = new Array(dimension)
  var tStride = new Array(dimension)
  for(var i=0; i<dimension; ++i) {
    tShape[i] = "a[i"+i+"]"
    tStride[i] = "b[i"+i+"]"
  }
  code.push("proto.transpose=function "+className+"_transpose("+args+"){"+
    args.map(function(n,idx) { return n + "=(" + n + "===undefined?" + idx + ":" + n + "|0)"}).join(";"),
    "var a=this.shape,b=this.stride;return new "+className+"(this.data,"+tShape.join(",")+","+tStride.join(",")+",this.offset)}")
  
  //view.pick():
  code.push("proto.pick=function "+className+"_pick("+args+"){var a=[],b=[],c=this.offset")
  for(var i=0; i<dimension; ++i) {
    code.push("if(typeof i"+i+"==='number'&&i"+i+">=0){c=(c+this.stride["+i+"]*i"+i+")|0}else{a.push(this.shape["+i+"]);b.push(this.stride["+i+"])}")
  }
  code.push("var ctor=CTOR_LIST[a.length+1];return ctor(this.data,a,b,c)}")
    
  //Add return statement
  code.push("return function construct_"+className+"(data,shape,stride,offset){return new "+className+"(data,"+
    indices.map(function(i) {
      return "shape["+i+"]"
    }).join(",")+","+
    indices.map(function(i) {
      return "stride["+i+"]"
    }).join(",")+",offset)}")

  //Compile procedure
  var procedure = new Function("CTOR_LIST", "ORDER", code.join("\n"))
  return procedure(CACHED_CONSTRUCTORS[dtype], order)
}

function arrayDType(data) {
  if(hasBuffer) {
    if(Buffer.isBuffer(data)) {
      return "buffer"
    }
  }
  if(hasTypedArrays) {
    switch(Object.prototype.toString.call(data)) {
      case "[object Float64Array]":
        return "float64"
      case "[object Float32Array]":
        return "float32"
      case "[object Int8Array]":
        return "int8"
      case "[object Int16Array]":
        return "int16"
      case "[object Int32Array]":
        return "int32"
      case "[object Uint8Array]":
        return "uint8"
      case "[object Uint16Array]":
        return "uint16"
      case "[object Uint32Array]":
        return "uint32"
      case "[object Uint8ClampedArray]":
        return "uint8_clamped"
    }
  }
  if(Array.isArray(data)) {
    return "array"
  }
  return "generic"
}

var CACHED_CONSTRUCTORS = {
  "float32":[],
  "float64":[],
  "int8":[],
  "int16":[],
  "int32":[],
  "uint8":[],
  "uint16":[],
  "uint32":[],
  "array":[],
  "uint8_clamped":[],
  "buffer":[],
  "generic":[]
}

;(function() {
  for(var id in CACHED_CONSTRUCTORS) {
    CACHED_CONSTRUCTORS[id].push(compileConstructor(id, -1))
  }
});

function wrappedNDArrayCtor(data, shape, stride, offset) {
  if(data === undefined) {
    var ctor = CACHED_CONSTRUCTORS.array[0]
    return ctor([])
  } else if(typeof data === "number") {
    data = [data]
  }
  if(shape === undefined) {
    shape = [ data.length ]
  }
  var d = shape.length
  if(stride === undefined) {
    stride = new Array(d)
    for(var i=d-1, sz=1; i>=0; --i) {
      stride[i] = sz
      sz *= shape[i]
    }
  }
  if(offset === undefined) {
    offset = 0
    for(var i=0; i<d; ++i) {
      if(stride[i] < 0) {
        offset -= (shape[i]-1)*stride[i]
      }
    }
  }
  var dtype = arrayDType(data)
  var ctor_list = CACHED_CONSTRUCTORS[dtype]
  while(ctor_list.length <= d+1) {
    ctor_list.push(compileConstructor(dtype, ctor_list.length-1))
  }
  var ctor = ctor_list[d+1]
  return ctor(data, shape, stride, offset)
}

module.exports = wrappedNDArrayCtor
}).call(this,require("buffer").Buffer)
},{"buffer":250,"iota-array":248}],248:[function(require,module,exports){
"use strict"

function iota(n) {
  var result = new Array(n)
  for(var i=0; i<n; ++i) {
    result[i] = i
  }
  return result
}

module.exports = iota
},{}],249:[function(require,module,exports){
var ndarray = require('ndarray');
var createScene = require('gl-plot3d');
var createSurfacePlot = require('gl-surface3d');

window.fftsize = 50;
var timesize = 30;
var varmap = {};

makescene = function(i) {

	varmap['scene'+i] = createScene({'canvas': document.getElementById('fft' + i + 'canvas'),
                                   'autoResize':false,
                                   'autoScale':false,
                                   'autoCenter':false,
                                   'autoBounds':true,
																	 'camera':{ eye:    [28.84134525894378, -26.3245391529961, 71.80368050495437],
																							center: [22.289583196651314, 20.08832142763649, 7.223370490280737],
																							up:     [0.002174851458812025, 0.8121432512118254, 0.5834540337783416],
																							zoomMax: 500}
																	 });
                                   //'axes':{'bounds':[[0, 0, 0], [30, 60, 30]]}});
	varmap['fft'+i] = ndarray(new Float32Array(window.fftsize*timesize), [window.fftsize,timesize]);
	varmap['surface'+i] = createSurfacePlot({
		gl:    varmap['scene'+i].gl,
		field: varmap['fft'+i]
	});
	varmap['scene'+i].add(varmap['surface'+i]);
	window['scene'+i] = varmap['scene'+1];
	window['surface'+i] = varmap['surface'+i];
	window['fft'+i] = varmap['fft'+i];
}

for(var i=1; i<9; i++) {
	makescene(i);
}

updatenewsize = function(fftsize) {
	fftsize /= 2;
	for(var chan=1; chan<9; chan++) {
		window['fft'+chan] = ndarray(new Float32Array(fftsize*timesize), [fftsize, timesize])
	}
}


},{"gl-plot3d":183,"gl-surface3d":246,"ndarray":247}],250:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding) {
  var self = this
  if (!(self instanceof Buffer)) return new Buffer(subject, encoding)

  var type = typeof subject
  var length

  if (type === 'number') {
    length = +subject
  } else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) {
    // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data)) subject = subject.data
    length = +subject.length
  } else {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (length > kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum size: 0x' +
      kMaxLength.toString(16) + ' bytes')
  }

  if (length < 0) length = 0
  else length >>>= 0 // coerce to uint32

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    self = Buffer._augment(new Uint8Array(length)) // eslint-disable-line consistent-this
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    self.length = length
    self._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    self._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++) {
        self[i] = subject.readUInt8(i)
      }
    } else {
      for (i = 0; i < length; i++) {
        self[i] = ((subject[i] % 256) + 256) % 256
      }
    }
  } else if (type === 'string') {
    self.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT) {
    for (i = 0; i < length; i++) {
      self[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize) self.parent = rootParent

  return self
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, totalLength) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function byteLength (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, target_start, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - target_start < end - start) {
    end = target.length - target_start + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":251,"ieee754":252,"is-array":253}],251:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],252:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],253:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],254:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;

function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    var currentQueue;
    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        var i = -1;
        while (++i < len) {
            currentQueue[i]();
        }
        len = queue.length;
    }
    draining = false;
}
process.nextTick = function (fun) {
    queue.push(fun);
    if (!draining) {
        setTimeout(drainQueue, 0);
    }
};

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[249]);
