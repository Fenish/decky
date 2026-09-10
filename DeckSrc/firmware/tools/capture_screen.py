"""Read the actual LCD framebuffer. Does not reset the board or alter its contents."""
import argparse
import time
from pathlib import Path
import serial
from PIL import Image
parser=argparse.ArgumentParser();parser.add_argument('--port',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
s=serial.Serial(port=None,baudrate=460800,timeout=0.3);s.dtr=False;s.rts=False;s.port=args.port;s.open()
try:
 s.reset_input_buffer();s.write(b'SCREEN\n');deadline=time.monotonic()+3;header=b''
 while time.monotonic()<deadline:
  header=s.readline().strip()
  if header.startswith(b'OK screen '):break
 if not header.startswith(b'OK screen '):raise RuntimeError('Firmware did not answer SCREEN')
 _,_,width,height,length=header.split();width,height,length=int(width),int(height),int(length)
 data=bytearray();deadline=time.monotonic()+30
 while len(data)<length and time.monotonic()<deadline:data.extend(s.read(length-len(data)))
 if len(data)!=length:raise RuntimeError(f'Incomplete screenshot: {len(data)}/{length}')
 rgb=bytearray(width*height*3)
 for i in range(width*height):
  color=data[i*2]|(data[i*2+1]<<8);rgb[i*3]=(color>>11)*255//31;rgb[i*3+1]=((color>>5)&63)*255//63;rgb[i*3+2]=(color&31)*255//31
 output=Path(args.out);output.parent.mkdir(parents=True,exist_ok=True);Image.frombytes('RGB',(width,height),bytes(rgb)).save(output)
 print(f'Saved {width}x{height} actual framebuffer; nonblack pixels: {sum(1 for i in range(0,len(data),2) if data[i] or data[i+1])}')
finally:s.close()
