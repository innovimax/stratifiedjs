/** NOTE: this file is very sensitive to inserted / removed lines,
 *  thus the use of a running "line" variable to provide a base.
 */

var test = require('../lib/testUtil').test;
var puts = require('sjs:logging').print;
var clean_stack = function(e) { return String(e).replace(/module [^ ]*stack-tests.sjs/g, 'this_file').replace(/module [^ ]*lib/g, "lib").replace(/^ *at ([^ ]* \()?/mg, '').replace(/(:[\d]+):[\d]+\)$/gm, '$1').replace(/\nthis_file:11$/, '').replace(/^Error(: [^\n]*)?\n/m, ''); }; // This could really do with some work ;)
var line;
var stack_from_running = function(f) {
  try {
    f.apply(this, arguments);
  } catch(e) {
    //puts('\n---- STACK: -----\n' + (e.stack)); puts('\n---- CLEANED STACK: -----\n' + (clean_stack(e)));
    return clean_stack(e);
  }
  throw new Error("fn " + f + " did not fail!");
};


line=20;
test('regular stack traces', 'this_file:' + (line+2) + '\nthis_file:' + (line+3) + '\nthis_file:' + (line+5), function() {
  var bottom_fn = function() { throw new Error("inner error"); };
  var mid_fn = function() { bottom_fn(); };
  // nothing on this line...
  var top_fn = function() { mid_fn(); };
  return stack_from_running(top_fn);
});


line=30;
test('stack from function with args & return', 'this_file:' + (line+2) + '\nthis_file:' + (line+3) + '\nthis_file:' + (line+4), function() {
  var bottom_fn = function(a, b, c) { throw new Error("inner error"); };
  var mid_fn = function(a, b, c) { return bottom_fn(a, b, c); };
  var top_fn = function(a, b, c) { return mid_fn(1, 2, 3); };
  return stack_from_running(top_fn);
});


line=39;
test('stack from function after delay', 'this_file:' + (line+2) + '\nthis_file:' + (line+3), function() {
  var bottom_fn = function() { hold(2); throw new Error("inner error"); };
  var top_fn = function() { return bottom_fn(1, 2, 3); };
  return stack_from_running(top_fn);
});


line=47;
test('stack from waitfor/and', 'this_file:' + (line+6) + '\nthis_file:' + (line+9), function() {
  var bottom_fn = function() {
    waitfor {
      hold(1);
    } and {
      throw new Error("inner error");
    }
  };
  var top_fn = function() { return bottom_fn(); };
  return stack_from_running(top_fn);
});


line=61;
test('stack from waitfor/or', 'this_file:' + (line+6) + '\nthis_file:' + (line+9), function() {
  var bottom_fn = function() {
    waitfor {
      hold(1);
    } and {
      throw new Error("inner error");
    }
  };
  var top_fn = function() { return bottom_fn(); };
  return stack_from_running(top_fn);
});


line=75;
test('stack from loop', 'this_file:' + (line+6) + '\nthis_file:' + (line+10), function() {
  var i = 0;
  var bottom_fn = function() {
    while(true) {
      i += 1;
      if(i == 4) throw new Error("inner error");
      hold(1);
    }
  };
  var top_fn = function() { return bottom_fn(); };
  return stack_from_running(top_fn);
});


line=90;
test('stack from error handling code', 'this_file:' + (line+2) + '\nthis_file:' + (line+7) + '\nthis_file:' + (line+14), function() {
  var bottom_fn = function() { hold(2); throw new Error("inner error"); };
  var middle_fn = function() {
    try {
      throw new Error("invisible error");
    } catch(e) {
      bottom_fn();
    }
  };
  var top_fn = function() {
    try {
      // noop
    } finally {
      return middle_fn();
    }
  };
  return stack_from_running(top_fn);
});


line=111;
test('stack with multiple entries on the same line', 'this_file:' + (line+2) + '\nthis_file:' + (line+3) + '\nthis_file:' + (line+3), function() {
  var bottom_fn = function() { hold(1); throw new Error("inner error"); };
  var middle_fn = function() { return bottom_fn(); }; var top_fn = function() { return middle_fn(); };
  return stack_from_running(top_fn);
});

line=118;
test('stack from tail-call', 'this_file:' + (line+2) + '\nthis_file:' + (line+3), function() {
  var bottom_fn = function() { hold(1); throw new Error("inner error"); };
  var middle_fn = function() { bottom_fn(); };
  return stack_from_running(middle_fn);
});

line=125;
var module = require('./lib/stack_js_module.js');
test('stack from imported JS', (module.fail_normally.expected_stack_lines.join("\n")) + '\nthis_file:' + (line+4), function() {
  var caller = function() {
    module.fail_normally();
  };
  var ret = stack_from_running(caller);
  return ret;
}); 

line=135;
test('stack from embedded JS', 'this_file:' + (line+11) + '\nthis_file:' + (line + 4) + '\nthis_file:' + (line + 7), function() {
  __js {
    var f1 = function() {
      f2();
    };
    var f2 = function() {
      throw new Error();
    };
  }
  var caller = function() {
    f1();
  };
  return stack_from_running(caller);
});

// things to note:
// - blocklambdas
// - tail calls?
// - interspersing with plain __js
// - parallel calls (waitfor ... and)
// - retracted calls
// - calls from a catch or finally


/*

A stacktrace consists of a) the (file:line) tuple where the exception
happened and b) the (file:line) tuples of all function callsites
travesed as the exception travels up the stack.

There are 4 main different code paths by which function callsites are
handled in VM1:

       | __oni_rt.C-encoded call  |  __oni_rt.Fcall-encoded call
-------|--------------------------|------------------------------
sync   |          1               |              3
-------|--------------------------|------------------------------
async  |          2               |              4
-------|--------------------------|------------------------------

__oni_rt.C-encoded calls are those where the arguments are known to be
nonblocking, e.g. a call such as foo(a, b, 1, 2, 4+5)

__oni_rt.Fcall-encoded calls are those where the arguments might suspend, e.g.:
foo(a()) <-- here a might suspend

Cases 1 & 3 are the 'easy' ones: __oni_rt.C/Fcall just annotate any exception that
gets thrown.

In cases 2 & 4, C/Fcall drop out of the picture: The function being
called returns an 'execution frame', and C/Fcall drop out of the
picture. Before they do, we record the (file:line) tuple of the
callsite in the execution frame (ef.callstack array)

Here we excercise those 4 paths:

*/

line= 194;
function outer(async) { 
  return inner(async); // line + 2
}

function inner(async) { 
  if (async) hold(0);
  throw new Error("inner error"); // line + 7
}

function id(x) { return x; }

test('codepath 1', "this_file:#{line+7}\nthis_file:#{line+2}\nthis_file:#{line+13}", function() { 
  return stack_from_running(function() { outer(false); }); // line + 13
});

test('codepath 2', "this_file:#{line+7}\nthis_file:#{line+2}\nthis_file:#{line+17}", function() { 
  return stack_from_running(function() { outer(true); }); // line + 17
});

test('codepath 3', "this_file:#{line+7}\nthis_file:#{line+2}\nthis_file:#{line+21}", function() { 
  return stack_from_running(function() { outer(id(false)); }); // line + 21
});

test('codepath 4', "this_file:#{line+7}\nthis_file:#{line+2}\nthis_file:#{line+25}", function() { 
  return stack_from_running(function() { outer(id(true)); }); // line + 25
});
