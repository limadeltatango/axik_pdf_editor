/**
 * APDF-19: read-only Windows printer and paper capabilities.
 *
 * IMPORTANT: installed-printer discovery and driver-advertised paper sizes do
 * not prove real paper is loaded or that duplex is working. No printer is
 * selected or used for spooling by these commands. Never send this information
 * to automatic telemetry.
 */
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct NativePrinter {
    name: String,
    is_local: bool,
    is_network: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct NativePaper {
    code: u16,
    name: String,
    width_mm: f64,
    height_mm: f64,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct NativePrinterCapabilities {
    printer_name: String,
    duplex_advertised: bool,
    color_advertised: bool,
    papers: Vec<NativePaper>,
    /** false = driver capability query failed; don't silently assume stock */
    capability_query_succeeded: bool,
    caveat: &'static str,
}

#[cfg(windows)]
mod win {
    use super::{NativePrinter,NativePaper,NativePrinterCapabilities};
    use std::ptr::{null, null_mut};
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW,PRINTER_INFO_4W,PRINTER_ENUM_LOCAL,
        PRINTER_ENUM_CONNECTIONS,PRINTER_ATTRIBUTE_LOCAL,
        PRINTER_ATTRIBUTE_NETWORK
    };
    use windows_sys::Win32::Storage::Xps::{
        DeviceCapabilitiesW,DC_PAPERS,DC_PAPERNAMES,
        DC_PAPERSIZE,DC_DUPLEX,DC_COLORDEVICE
    };

    fn bounded_wide_string(pointer:*const u16,buffer:&[u8])->Option<String>{
        if pointer.is_null() {return None}
        let start=buffer.as_ptr() as usize;
        let end=start.checked_add(buffer.len())?;
        let addr=pointer as usize;
        if addr<start || addr>=end || (addr-start)%2!=0{return None}
        let remaining=((end-addr)/2).min(512);
        let mut chars=Vec::new();
        for i in 0..remaining{
            let c=unsafe{std::ptr::read_unaligned(pointer.add(i))};
            if c==0{break}
            chars.push(c);
        }
        if chars.len()==remaining{return None}
        String::from_utf16(&chars).ok().filter(|s|!s.trim().is_empty())
    }

    pub fn installed()->Result<Vec<NativePrinter>,String>{
        let mut required=0u32;
        let mut returned=0u32;
        let flags=PRINTER_ENUM_LOCAL|PRINTER_ENUM_CONNECTIONS;
        unsafe {
            EnumPrintersW(flags,null(),4,null_mut(),0,&mut required,&mut returned);
        }
        if required==0{return Ok(Vec::new())}
        if required as usize>8*1024*1024 {
            return Err("Windows printer enumeration exceeds the safety bound.".into());
        }
        let mut bytes=vec![0u8;required as usize];
        let worked=unsafe{
            EnumPrintersW(flags,null(),4,bytes.as_mut_ptr(),required,
                &mut required,&mut returned)
        };
        if worked==0{return Err("Windows could not enumerate local printers.".into())}
        if returned>256 || (returned as usize)*size_of::<PRINTER_INFO_4W>()>bytes.len(){
            return Err("Windows returned too many printers.".into());
        }
        let mut items=Vec::new();
        for index in 0..returned as usize{
            let ptr=unsafe{bytes.as_ptr()
                .add(index*size_of::<PRINTER_INFO_4W>()) as *const PRINTER_INFO_4W};
            // Avoid relying on Vec<u8> allocation alignment guarantees.
            let data=unsafe{std::ptr::read_unaligned(ptr)};
            if let Some(name)=bounded_wide_string(data.pPrinterName,&bytes){
                if !items.iter().any(|p:&NativePrinter|p.name==name){
                    items.push(NativePrinter{
                        name,
                        is_local:(data.Attributes&PRINTER_ATTRIBUTE_LOCAL)!=0,
                        is_network:(data.Attributes&PRINTER_ATTRIBUTE_NETWORK)!=0
                    });
                }
            }
        }
        items.sort_by(|a,b|a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(items)
    }

    fn device_query(name:&[u16],code:u16,data:*mut u16)->i32{
        unsafe{DeviceCapabilitiesW(name.as_ptr(),null(),code,data,null())}
    }

    pub fn capabilities(name:&str)->Result<NativePrinterCapabilities,String>{
        if name.len()>512 || name.trim().is_empty(){
            return Err("Printer name is empty or too long.".into());
        }
        if !installed()?.iter().any(|p|p.name==name){
            return Err("That printer is not installed for the current Windows user.".into());
        }
        let wide:Vec<u16>=OsStr::new(name).encode_wide().chain(Some(0)).collect();
        let n=device_query(&wide,DC_PAPERS,null_mut());
        let duplex=device_query(&wide,DC_DUPLEX,null_mut())==1;
        let color=device_query(&wide,DC_COLORDEVICE,null_mut())==1;
        if n<=0 || n>256{
            return Ok(NativePrinterCapabilities{
                printer_name:name.to_owned(),duplex_advertised:duplex,
                color_advertised:color,papers:Vec::new(),
                capability_query_succeeded:false,
                caveat:"Driver capabilities are incomplete; physical paper/tray status is unknown."
            });
        }
        let count=n as usize;
        // Allocate for the entire validated upper limit in case capabilities
        // change between the initial query and the driver's follow-up copy.
        let mut paper_codes=vec![0u16;256];
        let mut paper_names=vec![0u16;256*64];
        let mut dimensions=vec![0i32;256*2];
        let count_codes=device_query(&wide,DC_PAPERS,paper_codes.as_mut_ptr());
        let count_names=device_query(&wide,DC_PAPERNAMES,paper_names.as_mut_ptr());
        let count_sizes=device_query(&wide,DC_PAPERSIZE,dimensions.as_mut_ptr() as *mut u16);
        if count_codes!=n || count_names!=n || count_sizes!=n{
            return Ok(NativePrinterCapabilities{
                printer_name:name.to_owned(),duplex_advertised:duplex,
                color_advertised:color,papers:Vec::new(),
                capability_query_succeeded:false,
                caveat:"Printer driver provided inconsistent media lists; use the system print dialog."
            });
        }
        let mut papers=Vec::with_capacity(count);
        for idx in 0..count{
            let x=dimensions[2*idx] as f64/10.0;
            let y=dimensions[2*idx+1] as f64/10.0;
            if x<=0.0 || y<=0.0 || x>2000.0 || y>2000.0{continue;}
            let raw=&paper_names[idx*64..(idx+1)*64];
            let stop=raw.iter().position(|v|*v==0).unwrap_or(64);
            let label=String::from_utf16_lossy(&raw[..stop]);
            papers.push(NativePaper{
                code:paper_codes[idx],
                name:if label.trim().is_empty(){
                    format!("Driver paper {}",paper_codes[idx])
                }else{label},
                width_mm:x,height_mm:y
            });
        }
        Ok(NativePrinterCapabilities{
            printer_name:name.to_owned(),duplex_advertised:duplex,
            color_advertised:color,
            papers,
            capability_query_succeeded:true,
            caveat:"Paper support is driver-advertised only. Loaded media, margins, duplex direction and completed printing are not verified."
        })
    }
}

#[tauri::command]
pub async fn list_native_printers()->Result<Vec<NativePrinter>,String>{
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(win::installed)
            .await.map_err(|_|"Windows printer discovery failed.".to_string())?
    }
    #[cfg(not(windows))]
    { Err("Native printer discovery requires Windows.".to_string()) }
}

#[tauri::command]
pub async fn get_native_printer_capabilities(
    printer_name:String
)->Result<NativePrinterCapabilities,String>{
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move||win::capabilities(&printer_name))
            .await.map_err(|_|"Printer capability query failed.".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _=printer_name;
        Err("Printer capability query requires Windows.".to_string())
    }
}
