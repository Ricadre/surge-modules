// Model subconverter's removeEmoji + trim path, used even by legacy emoji=false.
// https://github.com/tindy2013/subconverter/blob/master/src/generator/config/nodemanip.cpp
// https://github.com/tindy2013/subconverter/blob/master/src/handler/interfaces.cpp
module.exports = function convertedName(name) {
 const bytes=Buffer.from(name,'utf8');let offset=0;
 while(bytes[offset]===0xf0&&bytes[offset+1]===0x9f)offset+=4;
 return (offset===bytes.length?name:bytes.subarray(offset).toString('utf8')).trim();
};
