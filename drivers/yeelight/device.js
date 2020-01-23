'use strict';

const Homey = require('homey');
const util = require('/lib/util.js');
const net = require('net');
const tinycolor = require("tinycolor2");
var yeelights = {};

class YeelightDevice extends Homey.Device {

  onInit() {
    let id = this.getData().id;
    yeelights[id] = {};
    yeelights[id].data = this.getData();
    yeelights[id].socket = null;
    yeelights[id].timeout = null;
    yeelights[id].reconnect = null;
    yeelights[id].connecting = false;
    yeelights[id].connected = false;

    this.createDeviceSocket(id);

    // LISTENERS FOR UPDATING CAPABILITIES
    this.registerCapabilityListener('onoff', (value, opts) => {
      if (value) {
        return this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["on", "smooth", 500]}');
      } else {
        return this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["off", "smooth", 500]}');
      }
    });

    this.registerCapabilityListener('dim', async (value, opts) => {
      console.log(value);
      let brightness = value === 0 ? 1 : value * 100;
      // Logic which will toggle between night_mode and normal_mode when brightness is set to 0 or 100 two times within 5 seconds
      if (this.hasCapability('night_mode') && opts.duration === undefined) {
        if (value === 0) {
          if (this.dimMinTime + 5000 > Date.now()) {
            await this.triggerCapabilityListener('night_mode', true);
            if (this.getCapabilityValue('night_mode') === false) {
              brightness = 100;
            }
            this.dimMinTime = 0;
          } else {
            this.dimMinTime = Date.now();
          }
        } else if (value === 1) {
          if (this.dimMaxTime + 5000 > Date.now()) {
            await this.triggerCapabilityListener('night_mode', false);
            if (this.getCapabilityValue('night_mode') === true) {
              brightness = 1;
            }
            this.dimMaxTime = 0;
          } else {
            this.dimMaxTime = Date.now();
          }
        } else {
          this.dimMinTime = 0;
          this.dimMaxTime = 0;
        }
      }

      if (opts.duration === undefined || typeof opts.duration == 'undefined') {
        opts.duration = '500';
      }

      if (value === 0 && !this.hasCapability('night_mode')) {
        return this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["off", "smooth", 500]}');
      } else if (value === 0) {
        if (this.getData().model == 'ceiling4') {
          var color_temp = util.denormalize(this.getCapabilityValue('light_temperature'), 2700, 6000);
        } else if (this.getData().model == 'color') {
          var color_temp = util.denormalize(this.getCapabilityValue('light_temperature'), 1700, 6500);
        } else {
          var color_temp = util.denormalize(this.getCapabilityValue('light_temperature'), 2700, 6500);
        }
        return this.sendCommand(this.getData().id, '{"id":1,"method":"start_cf","params":[1, 2, "'+ opts.duration +', 2, '+ color_temp +', 0"]}');
      } else {
        return this.sendCommand(this.getData().id, '{"id":1,"method":"set_bright","params":['+ brightness +', "smooth", '+ opts.duration +']}');
      }
    });

    this.registerCapabilityListener('night_mode', (value, opts) => {
      if (value) {
        return this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["on", "smooth", 500, 5]}');
      } else {
        return this.sendCommand(this.getData().id, '{"id": 1, "method": "set_power", "params":["on", "smooth", 500, 1]}');
      }
    });

    this.registerMultipleCapabilityListener(['light_hue', 'light_saturation' ], ( valueObj, optsObj ) => {
      if (!this.getCapabilityValue('onoff')) {
        this.setCapabilityValue('onoff', true);
      }

      if (typeof valueObj.light_hue !== 'undefined') {
        var hue_value = valueObj.light_hue;
      } else {
        var hue_value = this.getCapabilityValue('light_hue');
      }

      if (typeof valueObj.light_saturation !== 'undefined') {
        var saturation_value = valueObj.light_saturation;
      } else {
        var saturation_value = this.getCapabilityValue('light_saturation');
      }

      var hue = hue_value * 359;
      var saturation = saturation_value * 100;

      if (this.getData().model == 'ceiling4' || this.getData().model == 'ceiling10') {
        return this.sendCommand(this.getData().id, '{"id":1,"method":"bg_set_hsv","params":['+ hue +','+ saturation +', "smooth", 500]}');
      } else {
        return this.sendCommand(this.getData().id, '{"id":1,"method":"set_hsv","params":['+ hue +','+ saturation +', "smooth", 500]}');
      }
    }, 500);

    this.registerCapabilityListener('light_temperature', (value, opts) => {
      if (!this.getCapabilityValue('onoff')) {
        this.setCapabilityValue('onoff', true);
      }

      if (this.getData().model == 'ceiling4') {
        var color_temp = util.denormalize(value, 2700, 6000);
      } else if (this.getData().model == 'color') {
        var color_temp = util.denormalize(value, 1700, 6500);
      } else {
        var color_temp = util.denormalize(value, 2700, 6500);
      }
      if (this.hasCapability('night_mode')) {
        this.setCapabilityValue('night_mode', false);
      }
      return this.sendCommand(this.getData().id, '{"id":1,"method":"set_ct_abx","params":['+ color_temp +', "smooth", 500]}');
    });

  }

  onDeleted() {
    let id = this.getData().id;
    if (yeelights[id].socket) {
      yeelights[id].socket.destroy();
    }
    delete yeelights[id];
  }

  // HELPER FUNCTIONS

  /* establish socket with online devices and update state upon connect */
  createDeviceSocket(id) {
    let device = Homey.ManagerDrivers.getDriver('yeelight').getDevice(yeelights[id].data);

    try {
      if (yeelights[id].socket === null && yeelights[id].connecting === false && yeelights[id].connected === false) {
        yeelights[id].connecting = true;
        yeelights[id].socket = new net.Socket();
        yeelights[id].socket.connect(device.getSetting('port'), device.getSetting('address'), function() {
          yeelights[id].socket.setKeepAlive(true, 5000);
          yeelights[id].socket.setTimeout(0);
        });
      } else {
        this.log("Yeelight - trying to create socket, but connection not cleaned up previously.");
      }
    } catch (error) {
  		this.log("Yeelight - error creating socket: " + error);
  	}

    yeelights[id].socket.on('connect', () => {
      yeelights[id].connecting = false;
      yeelights[id].connected = true;

      if (!device.getAvailable()) {
        device.setAvailable();
      }

      /* get current light status 4 seconds after connection */
      setTimeout(() => {
        if (yeelights[id].socket !== null) {
          yeelights[id].socket.write('{"id":1,"method":"get_prop","params":["power", "bright", "color_mode", "ct", "rgb", "hue", "sat"]}' + '\r\n');
        }
      }, 4000);
    });

    yeelights[id].socket.on('error', (error) => {
      this.log("Yeelight - socket error: "+ error);
      yeelights[id].connected = false;

      if (yeelights[id].socket) {
        yeelights[id].socket.destroy();
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error == 'Error: Error sending command') {
        this.log("Yeelight - trying to reconnect in 6 seconds.");
        var time2retry = 6000;
      } else {
        this.log("Yeelight - trying to reconnect in 60 seconds.");
        var time2retry = 60000;
      }

      if (yeelights[id].reconnect === null) {
        yeelights[id].reconnect = setTimeout(() => {
          if (yeelights[id].connecting === false && yeelights[id].connected === false) {
            this.createDeviceSocket(id);
          }
          yeelights[id].reconnect = null;
        }, time2retry);
      }
    });

    yeelights[id].socket.on('close', (had_error) => {
      yeelights[id].connecting = false;
      yeelights[id].connected = false;
      yeelights[id].socket = null;
      device.setUnavailable(Homey.__('unreachable'));
    });

    yeelights[id].socket.on('data', (message, address) => {
      if (typeof yeelights[id] !== "undefined") {
        clearTimeout(yeelights[id].timeout);
        clearTimeout(yeelights[id].reconnect);
        yeelights[id].reconnect = null;
      }

      if(!device.getAvailable()) {
        device.setAvailable();
      }

      var result = message.toString();
      var result = result.replace(/{"id":1, "result":\["ok"\]}/g, "").replace(/\r\n/g,'');

      if (result.includes('props')) {
        try {
          var result = JSON.parse(result);
          var key = Object.keys(result.params)[0];

          switch (key) {
            case 'power':
              if(result.params.power == 'on' && device.getCapabilityValue('onoff') == false) {
                device.setCapabilityValue('onoff', true);
              } else if (result.params.power == 'off' && device.getCapabilityValue('onoff') == true) {
                device.setCapabilityValue('onoff', false);
              }
              break;
            case 'bright':
              var dim = result.params.bright / 100;
              if (device.getCapabilityValue('dim') != dim) {
                device.setCapabilityValue('dim', dim);
              }
              break;
            case 'ct':
              if (device.getData().model == 'ceiling4') {
                var color_temp = util.normalize(result.params.ct, 2700, 6000);
              } else if (device.getData().model == 'color') {
                var color_temp = util.normalize(result.params.ct, 1700, 6500);
              } else {
                var color_temp = util.normalize(result.params.ct, 2700, 6500);
              }
              if (device.hasCapability('light_temperature')) {
                if (device.getCapabilityValue('light_temperature') != color_temp) {
                  device.setCapabilityValue('light_temperature', color_temp);
                }
              }
              break;
            case 'rgb':
              var color = tinycolor(result.params.rgb.toString(16));
              var hsv = color.toHsv();
              var hue = Math.round(hsv.h) / 359;
              var saturation = Math.round(hsv.s);
              if (device.hasCapability('light_hue') && device.hasCapability('light_saturation')) {
                if (device.getCapabilityValue('light_hue') != hue) {
                  device.setCapabilityValue('light_hue', hue);
                }
                if (device.getCapabilityValue('light_saturation') != saturation) {
                  device.setCapabilityValue('light_saturation', saturation);
                }
              }
              break;
            case 'hue':
              var hue = result.params.hue / 359;
              if (device.hasCapability('light_hue')) {
                if (device.getCapabilityValue('light_hue') != hue) {
                  device.setCapabilityValue('light_hue', hue);
                }
              }
              break;
            case 'sat':
              var saturation = result.params.sat / 100;
              if (device.hasCapability('light_saturation')) {
                if (device.getCapabilityValue('light_saturation') != saturation) {
                  device.setCapabilityValue('light_saturation', saturation);
                }
              }
              break;
            case 'color_mode':
              if (device.hasCapability('light_mode')) {
                if (result.params.color_mode == 2) {
                  device.setCapabilityValue('light_mode', 'temperature');
                } else {
                  device.setCapabilityValue('light_mode', 'color');
                }
              }
              break;
            case 'nl_br':
              if (result.params.nl_br !== 0) {
                var dim = result.params.nl_br / 100;
                if (device.getCapabilityValue('dim') != dim) {
                  device.setCapabilityValue('dim', dim);
                }
              }
              if (device.hasCapability('night_mode')) {
                if (result.params.active_mode == 0 && device.getCapabilityValue('night_mode') == true) {
                  device.setCapabilityValue('night_mode', false);
                } else if (result.params.active_mode != 0 && device.getCapabilityValue('night_mode') == false) {
                  device.setCapabilityValue('night_mode', true);
                }
              }
              break;
            default:
              break;
          }

        } catch (error) {
          this.log('Unable to process message because of error: '+ error);
        }
      } else if (result.includes('result')) {
        try {
          var result = JSON.parse(result);

          if (result.result[0] != "ok") {
            var dim = result.result[1] / 100;
            var hue = result.result[5] / 359;
            var saturation = result.result[6] / 100;
            if (device.getData().model == 'ceiling4') {
              var color_temp = util.normalize(result.result[3], 2700, 6000);
            } else if (device.getData().model == 'color') {
              var color_temp = util.normalize(result.result[3], 1700, 6500);
            } else {
              var color_temp = util.normalize(result.result[3], 2700, 6500);
            }
            if(result.result[2] == 2) {
              var color_mode = 'temperature';
            } else {
              var color_mode = 'color';
            }

            if(result.result[0] == 'on' && device.getCapabilityValue('onoff') != true) {
              device.setCapabilityValue('onoff', true);
            } else if (result.result[0] == 'off' && device.getCapabilityValue('onoff') != false) {
              device.setCapabilityValue('onoff', false);
            }
            if (device.getCapabilityValue('dim') != dim) {
              device.setCapabilityValue('dim', dim);
            }
            if (device.hasCapability('light_mode')) {
              if (device.getCapabilityValue('light_mode') != color_mode) {
                device.setCapabilityValue('light_mode', color_mode);
              }
            }
            if (device.hasCapability('light_temperature')) {
              if (device.getCapabilityValue('light_temperature') != color_temp) {
                device.setCapabilityValue('light_temperature', color_temp);
              }
            }
            if (device.hasCapability('light_hue')) {
              if (device.getCapabilityValue('light_hue') != hue) {
                device.setCapabilityValue('light_hue', hue);
              }
            }
            if (device.hasCapability('light_saturation')) {
              if (device.getCapabilityValue('light_saturation') != saturation) {
                device.setCapabilityValue('light_saturation', saturation);
              }
            }
          }
        } catch (error) {
          this.log('Unable to process message because of error: '+ error);
        }
      }
  	});
  }

  /* send commands to devices using their socket connection */
  sendCommand(id, command) {
    return new Promise(function (resolve, reject) {
      if(yeelights[id].connecting && yeelights[id].connected === false){
        return reject('Unable to send command because socket is still connecting');
      } else if (yeelights[id].connected === false && yeelights[id].socket !== null) {
        yeelights[id].socket.emit('error', new Error('Connection to device broken'));
        return reject('Connection to device broken');
      } else if (yeelights[id].socket === null) {
        return reject('Unable to send command because socket is not available');
    	} else {
        yeelights[id].socket.write(command + '\r\n');
        return resolve();

        clearTimeout(yeelights[id].timeout);
        yeelights[id].timeout = setTimeout(() => {
          if (yeelights[id].connected === true && yeelights[id].socket !== null) {
            yeelights[id].socket.emit('error', new Error('Error sending command'));
          }
        }, 6000);
      }
    });
  }

  /* check if device is connecting or connected */
  isConnected(id) {
  	if (yeelights[id].connecting === true || yeelights[id].connected === true) {
      return true;
  	} else {
      return false;
    }
  }
}

module.exports = YeelightDevice;
